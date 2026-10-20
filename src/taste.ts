/**
 * Step 3: Client-side taste vector (ESM, browser-only).
 * Persists under cinematch:taste prefix. No server dependency.
 */

import type { Movie } from './types';
import { SIGNAL_WEIGHTS } from './feedback';

/** Learning rate per event. Must match server/taste.ts LR. */
export const LR = 0.15;

/** Per-session decay applied once per page load. Must match server/taste.ts DECAY. */
export const DECAY = 0.98;

/** Max features per vector. Must match server/taste.ts MAX_FEATURES. */
export const MAX_FEATURES = 64;

/** Taste key prefix in localStorage. */
export const TASTE_KEY_PREFIX = 'cinematch:taste';

/** Feature extractor matching server/taste.ts movieFeatures. */
export function movieFeatures(m: Movie): Record<string, number> {
  const feats: Record<string, number> = {};

  // genre:* (each active genre = 1)
  for (const g of m.genres) {
    feats[`genre:${g.toLowerCase()}`] = 1;
  }

  // language:* (primary language = 1)
  if (m.language) {
    feats[`language:${m.language.toLowerCase()}`] = 1;
  }

  // era:* (exactly one bucket = 1)
  const year = m.year ?? 2000;
  let era = '2020plus';
  if (year < 2000) era = 'pre2000';
  else if (year < 2010) era = '2000s';
  else if (year < 2020) era = '2010s';
  feats[`era:${era}`] = 1;

  return feats;
}

/** Get current taste vector for this anonId. */
export function getTasteVector(anonId: string): Record<string, number> {
  try {
    const key = `${TASTE_KEY_PREFIX}:${anonId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const num = Number(v);
      if (Number.isFinite(num)) out[k] = Math.max(-1, Math.min(1, num));
    }
    return out;
  } catch {
    return {};
  }
}

/** Save taste vector for this anonId. */
export function setTasteVector(anonId: string, vec: Record<string, number>): void {
  try {
    const key = `${TASTE_KEY_PREFIX}:${anonId}`;
    if (Object.keys(vec).length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(vec));
    }
  } catch {
    // storage full/unavailable — ignore
  }
}

/** Apply one session's decay (once per page load). */
export function applyDecay(anonId: string): void {
  const vec = getTasteVector(anonId);
  let changed = false;
  for (const k of Object.keys(vec)) {
    vec[k] *= DECAY;
    if (Math.abs(vec[k]) < 0.01) {
      delete vec[k];
      changed = true;
    } else {
      changed = true;
    }
  }
  if (changed) setTasteVector(anonId, vec);
}

/** Update taste from a feedback action on one movie.
 *  s = signal weight (save=+1, not_for_me=-1, less_like_this=-0.5, different_picks=-0.15)
 *  x_f = 1 for each feature of the movie
 *  w[f] = clip(DECAY * w[f] + LR * s * x_f, -1, 1)
 */
export function updateTasteFromEvent(
  anonId: string,
  movie: Movie,
  action: 'save' | 'not_for_me' | 'less_like_this' | 'different_picks'
): void {
  const signal = SIGNAL_WEIGHTS[action];
  if (signal === 0 || signal === undefined) return;

  const vec = getTasteVector(anonId);
  const feats = movieFeatures(movie);

  for (const f of Object.keys(feats)) {
    const old = vec[f] ?? 0;
    const updated = Math.max(-1, Math.min(1, DECAY * old + LR * signal * 1));
    if (Math.abs(updated) < 0.01) {
      delete vec[f];
    } else {
      vec[f] = updated;
    }
  }

  // Cap at MAX_FEATURES — keep largest absolute weights
  const entries = Object.entries(vec);
  if (entries.length > MAX_FEATURES) {
    entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const capped = Object.fromEntries(entries.slice(0, MAX_FEATURES));
    setTasteVector(anonId, capped);
  } else {
    setTasteVector(anonId, vec);
  }
}

/** Get taste payload to send with recommend request. */
export function getTastePayload(anonId: string, eventCount: number): {
  weights: Record<string, number>;
  eventCount: number;
} {
  return {
    weights: getTasteVector(anonId),
    eventCount: Math.min(eventCount, 1000),
  };
}