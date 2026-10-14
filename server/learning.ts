/**
 * Privacy-safe learning foundation (Step 1).
 *
 * SQLite tables for signed impressions + feedback events + crowd priors.
 * No free text, no IPs, no emails are ever stored: anonId is a random
 * browser UUID, contextKey is a coarse quiz bucket, and event ingestion
 * requires an HMAC token issued with the recommendation response.
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseNote } from './noteParser.js';
import type { RecommendParams } from './omdb.js';

/** Kill switch: LEARNING_ENABLED=false disables tokens + /api/event. */
export const LEARNING_ENABLED = process.env.LEARNING_ENABLED !== 'false';
/** Impression tokens expire after 12h (recommend tonight, act tonight). */
export const TOKEN_TTL_MS = 12 * 3600 * 1000;
/** Hard cap on /api/event JSON body size. */
export const MAX_EVENT_BODY_BYTES = 2048;
/** Max stored events per anonId per rolling 24h (poisoning cap). */
export const MAX_EVENTS_PER_ANON_PER_DAY = 200;
/** Burst caps for /api/event (per key, per 10 min). */
export const EVENT_BURST_WINDOW_MS = 10 * 60 * 1000;
export const EVENT_BURST_PER_ANON = 120;
export const EVENT_BURST_PER_IPHASH = 300;

export const EVENT_ACTIONS = new Set([
  'save',
  'provider_click',
  'more_like_this',
  'seen_it',
  'seen_it_liked',
  'not_for_me',
  'different_picks',
]);

function hmacSecret(): Buffer {
  const fromEnv = (process.env.LEARNING_HMAC_SECRET || '').trim();
  if (fromEnv) return Buffer.from(fromEnv, 'utf8');
  // Ephemeral per-boot secret: tokens verify only within this process run.
  console.warn('[learning] LEARNING_HMAC_SECRET unset — using an ephemeral secret');
  return crypto.randomBytes(32);
}
let SECRET: Buffer | null = null;
function secret(): Buffer {
  if (!SECRET) SECRET = hmacSecret();
  return SECRET;
}
/** Test hook: reset the cached secret (tests only). */
export function _resetSecretForTests(): void {
  SECRET = null;
}

export interface ImpressionRow {
  impressionId: string;
  anonId: string;
  ts: number;
  contextKey: string;
  movieId: number;
  slot: number;
  rankPosition: number;
  isExploration: number;
  explorationProb: number;
  scoreBreakdownJson: string;
  variant: string;
}

export function openLearningDb(filePath?: string): Database.Database {
  const target =
    filePath ?? process.env.LEARNING_DB_PATH ?? path.resolve(process.cwd(), 'data', 'learning.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.exec(`
    CREATE TABLE IF NOT EXISTS impressions (
      impressionId TEXT PRIMARY KEY,
      anonId TEXT NOT NULL,
      ts INTEGER NOT NULL,
      contextKey TEXT NOT NULL,
      movieId INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      rankPosition INTEGER NOT NULL,
      isExploration INTEGER NOT NULL DEFAULT 0,
      explorationProb REAL NOT NULL DEFAULT 0,
      scoreBreakdownJson TEXT NOT NULL DEFAULT '{}',
      variant TEXT NOT NULL DEFAULT 'control'
    );
    CREATE TABLE IF NOT EXISTS events (
      eventId TEXT PRIMARY KEY,
      impressionId TEXT NOT NULL,
      anonId TEXT NOT NULL,
      ts INTEGER NOT NULL,
      action TEXT NOT NULL,
      movieId INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS priors (
      contextKey TEXT NOT NULL,
      movieId INTEGER NOT NULL,
      saves INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (contextKey, movieId)
    );
    CREATE INDEX IF NOT EXISTS idx_impressions_anon_ts ON impressions (anonId, ts);
    CREATE INDEX IF NOT EXISTS idx_impressions_context ON impressions (contextKey);
    CREATE INDEX IF NOT EXISTS idx_events_anon_ts ON events (anonId, ts);
  `);
  return db;
}

/**
 * Coarse, non-identifying context bucket. Quiz enums only + parsed note
 * signals (no free text ever enters this string).
 */
export function buildContextKey(params: RecommendParams, noteText?: string): string {
  const note = parseNote(noteText || '');
  const parts = [
    `mood=${params.mood}`,
    `aud=${params.audience}`,
    `rt=${params.maxRuntime}`,
    `lang=${[...(params.languages || [])].sort().join('+') || 'Any'}`,
    `genre=${[...(params.genres || [])].sort().join('+') || 'Surprise'}`,
    `pref=${[
      params.preferences?.highlyRated ? 'HR' : '',
      params.preferences?.hiddenGems ? 'HG' : '',
      params.preferences?.recent ? 'R' : '',
      params.preferences?.classics ? 'C' : '',
      params.preferences?.mature ? 'M' : '',
    ]
      .join('')}`,
    `ng=${[...note.genres].sort().join('+')}`,
    `xg=${[...note.excludeGenres].sort().join('+')}`,
    `era=${note.eraHint || ''}`,
    `rh=${note.runtimeHint || ''}`,
  ];
  return parts.join('|');
}

/** anonId: random browser UUID; never an IP, email, or login. */
export function validateAnonId(v: unknown): boolean {
  return typeof v === 'string' && v.length >= 1 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v);
}
export function normalizeAnonId(v: unknown): string {
  return validateAnonId(v) ? (v as string) : 'none';
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}
function b64urlDecode(s: string): string | null {
  try {
    return Buffer.from(s, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/** Sign one shown movie. Binds impressionId + movieId + anonId + expiry. */
export function signImpression(
  impressionId: string,
  movieId: number,
  anonId: string,
  expOverrideMs?: number
): string {
  const payload = b64urlEncode(
    JSON.stringify({ i: impressionId, m: movieId, a: anonId, e: expOverrideMs ?? Date.now() + TOKEN_TTL_MS })
  );
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export type VerifyResult =
  | { ok: true; impressionId: string; movieId: number; anonId: string }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' | 'anon-mismatch' };

/** Verify a token; optionally require it to belong to expectedAnonId. */
export function verifyImpression(token: unknown, expectedAnonId?: string): VerifyResult {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const dot = token.indexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: 'malformed' };
  const expected = crypto.createHmac('sha256', secret()).update(payloadB64).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }
  const raw = b64urlDecode(payloadB64);
  if (!raw) return { ok: false, reason: 'malformed' };
  let p: { i?: unknown; m?: unknown; a?: unknown; e?: unknown };
  try {
    p = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof p.i !== 'string' || p.i.length === 0 || p.i.length > 64 ||
    typeof p.m !== 'number' || !Number.isInteger(p.m) ||
    typeof p.a !== 'string' || p.a.length > 64 ||
    typeof p.e !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (p.e <= Date.now()) return { ok: false, reason: 'expired' };
  if (expectedAnonId !== undefined && p.a !== expectedAnonId) {
    return { ok: false, reason: 'anon-mismatch' };
  }
  return { ok: true, impressionId: p.i, movieId: p.m, anonId: p.a };
}

export interface ValidEvent {
  eventId: string;
  impressionId: string;
  anonId: string;
  action: string;
  movieId: number;
  token: string;
}

export function validateEventBody(body: unknown): { ok: true; value: ValidEvent } | { ok: false; error: string; status: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Invalid event body', status: 400 };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.eventId !== 'string' || b.eventId.length === 0 || b.eventId.length > 64) {
    return { ok: false, error: 'Invalid eventId', status: 400 };
  }
  if (!validateAnonId(b.anonId)) return { ok: false, error: 'Invalid anonId', status: 400 };
  if (typeof b.impressionId !== 'string' || b.impressionId.length === 0 || b.impressionId.length > 64) {
    return { ok: false, error: 'Invalid impressionId', status: 400 };
  }
  if (typeof b.action !== 'string' || !EVENT_ACTIONS.has(b.action)) {
    return { ok: false, error: 'Invalid action', status: 400 };
  }
  if (typeof b.movieId !== 'number' || !Number.isInteger(b.movieId)) {
    return { ok: false, error: 'Invalid movieId', status: 400 };
  }
  if (typeof b.token !== 'string' || b.token.length === 0 || b.token.length > 2048) {
    return { ok: false, error: 'Invalid token', status: 401 };
  }
  return {
    ok: true,
    value: {
      eventId: b.eventId,
      impressionId: b.impressionId,
      anonId: b.anonId as string,
      action: b.action as string,
      movieId: b.movieId as number,
      token: b.token as string,
    },
  };
}

export function recordImpressions(db: Database.Database, rows: ImpressionRow[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO impressions
     (impressionId, anonId, ts, contextKey, movieId, slot, rankPosition, isExploration, explorationProb, scoreBreakdownJson, variant)
     VALUES (@impressionId, @anonId, @ts, @contextKey, @movieId, @slot, @rankPosition, @isExploration, @explorationProb, @scoreBreakdownJson, @variant)`
  );
  const tx = db.transaction((rs: ImpressionRow[]) => {
    for (const r of rs) stmt.run(r);
  });
  tx(rows);
}

export function findImpression(
  db: Database.Database,
  impressionId: string
): { impressionId: string; anonId: string; movieId: number } | null {
  const row = db
    .prepare('SELECT impressionId, anonId, movieId FROM impressions WHERE impressionId = ?')
    .get(impressionId) as { impressionId: string; anonId: string; movieId: number } | undefined;
  return row ?? null;
}

/** Idempotent by eventId: replays are a no-op returning 'duplicate'. */
export function recordEvent(
  db: Database.Database,
  evt: { eventId: string; impressionId: string; anonId: string; action: string; movieId: number; ts: number }
): 'stored' | 'duplicate' {
  const r = db
    .prepare(
      'INSERT OR IGNORE INTO events (eventId, impressionId, anonId, ts, action, movieId) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(evt.eventId, evt.impressionId, evt.anonId, evt.ts, evt.action, evt.movieId);
  return r.changes === 0 ? 'duplicate' : 'stored';
}

export function countAnonEventsSince(db: Database.Database, anonId: string, sinceMs: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM events WHERE anonId = ? AND ts >= ?')
    .get(anonId, sinceMs) as { n: number };
  return row.n;
}

/** Poisoning cap: at most MAX_EVENTS_PER_ANON_PER_DAY stored per rolling 24h. */
export function anonOverDailyCap(db: Database.Database, anonId: string, nowMs = Date.now()): boolean {
  return countAnonEventsSince(db, anonId, nowMs - 24 * 3600 * 1000) >= MAX_EVENTS_PER_ANON_PER_DAY;
}

/** SHA-256 hash for rate-limit keys. Raw IPs are never stored. */
export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

export interface BurstSlot {
  count: number;
  resetTime: number;
}

/** Generic bounded burst gate over an in-memory map (sweeps when large). */
export function burstExceeded(
  store: Map<string, BurstSlot>,
  key: string,
  limit: number,
  windowMs: number,
  nowMs = Date.now()
): boolean {
  if (store.size > 2000) {
    for (const [k, v] of store) if (v.resetTime <= nowMs) store.delete(k);
  }
  const slot = store.get(key);
  if (!slot || slot.resetTime <= nowMs) {
    store.set(key, { count: 1, resetTime: nowMs + windowMs });
    return false;
  }
  if (slot.count >= limit) return true;
  slot.count += 1;
  return false;
}
