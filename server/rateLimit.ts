/**
 * Serverless-compatible rate limiter: a per-IP counter in Postgres instead
 * of the in-memory Map, which resets on every serverless cold start and is
 * therefore useless against abuse across instances.
 *
 * - IPs are never stored raw: sha256(ip + IP_HASH_SALT), truncated.
 * - One atomic upsert counts the request and returns the new count.
 * - Fail-open: any DB problem lets the request through (availability over
 *   enforcement) and logs once per interval, so the catalog never goes dark
 *   because a counter table hiccupped.
 * - When DATABASE_URL is absent (local dev without a DB) falls back to the
 *   old in-memory counter, and its documented limitation applies only there.
 */
import { createHash } from 'node:crypto';
import { getPool } from './db.js';

const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = Math.max(
  1,
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30', 10) || 30,
);

export { RATE_LIMIT_WINDOW, MAX_REQUESTS };

interface RateIpRequest {
  /** The client IP (from x-forwarded-for / socket). Stored only hashed. */
  ip: string;
}

function ipHash(ip: string): string {
  const salt = process.env.IP_HASH_SALT || 'movie-night-picker-default-salt';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

/** One round trip: upsert the counter, return the new count for the window. */
async function countPostgres(hash: string): Promise<number> {
  const windowId = Math.floor(Date.now() / RATE_LIMIT_WINDOW);
  const { rows } = await getPool().query<{ count: number }>(
    `INSERT INTO rate_limits (ip_hash, window_id, count)
       VALUES ($1::text, $2::bigint, 1)
       ON CONFLICT (ip_hash)
       DO UPDATE SET count = CASE
            WHEN rate_limits.window_id = $2::bigint THEN rate_limits.count + 1
            ELSE 1
          END,
          window_id = $2::bigint
       RETURNING count`,
    [hash, windowId],
  );
  return rows[0].count;
}

// In-memory fallback (no DATABASE_URL): documented limitation — the counter
// is per-instance and survives only this process.
const memoryCounts = new Map<string, { windowId: number; count: number }>();

function countMemory(hash: string): number {
  const windowId = Math.floor(Date.now() / RATE_LIMIT_WINDOW);
  if (memoryCounts.size > 1000) {
    for (const [k, v] of memoryCounts) if (v.windowId !== windowId) memoryCounts.delete(k);
  }
  const prev = memoryCounts.get(hash);
  const entry = prev && prev.windowId === windowId
    ? { windowId, count: prev.count + 1 }
    : { windowId, count: 1 };
  memoryCounts.set(hash, entry);
  return entry.count;
}

let lastFailureLog = 0;

/**
 * True = allow, false = over the limit. Never throws.
 */
export async function allowRequest({ ip }: RateIpRequest): Promise<boolean> {
  if (!process.env.DATABASE_URL) return countMemory(ipHash(ip)) <= MAX_REQUESTS;
  try {
    const count = await countPostgres(ipHash(ip));
    return count <= MAX_REQUESTS;
  } catch (err) {
    const now = Date.now();
    if (now - lastFailureLog > 60000) {
      lastFailureLog = now;
      console.warn('[rateLimit] store unavailable, failing open:',
        err instanceof Error ? err.message : String(err));
    }
    return true;
  }
}
