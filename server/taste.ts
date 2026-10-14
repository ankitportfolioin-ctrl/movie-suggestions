/**
 * Step 3: Personal taste learning — pure, side-effect-free helpers.
 * Server-side: sanitize/validate incoming taste vector, compute bonus.
 * Client-side: update rule lives in src/taste.ts (ESM shared is awkward).
 */

import type { RankableMovie } from './ranking.js';

/** All valid feature namespaces. Unknown keys are dropped. */
export const VALID_FEATURE_PREFIXES = [
  'genre:',
  'language:',
  'era:',
] as const;

/** Max features per vector — prevents pathological payloads. */
export const MAX_FEATURES = 64;

/** Learning rate per event. */
export const LR = 0.15;

/** Per-session decay (applied once per page load in the browser). */
export const DECAY = 0.98;

/** Confidence ramp: full taste weight at 8 events. */
export const CONFIDENCE_RAMP = 8;

/** Max number of events the server will trust for confidence calc. */
export const MAX_EVENT_COUNT = 1000;

/** Maximum score from ranking weights (see RANK_WEIGHTS sum ≈ 40). */
export const MAX_RANKING_SCORE = 40.0;

/** Lambda so max taste bonus ≈ 15% of MAX_RANKING_SCORE (6.0 / 40 = 0.15).
 * Average feature weight ∈ [-1, 1], movie has ~4 matched features.
 * avg ∈ [-1, 1], so max bonus = TASTE_LAMBDA * 1.0.
 * We want max bonus ≈ 6.0 → TASTE_LAMBDA = 6.0.
 */
export const TASTE_LAMBDA = 6.0;

/** Feature extractor for a movie (namespaced, ~30-60 total space). */
export function movieFeatures(m: RankableMovie): Record<string, number> {
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

/** Dot product of two sparse vectors. */
function dot(a: Record<string, number>, b: Record<string, number>): number {
  let sum = 0;
  for (const [k, v] of Object.entries(a)) {
    if (typeof b[k] === 'number') sum += v * b[k];
  }
  return sum;
}

/** Sanitize incoming taste vector — never throws, never fails a request.
 *  - drops unknown keys (prefix not in VALID_FEATURE_PREFIXES)
 *  - ignores non-finite values
 *  - clamps values to [-1, 1]
 *  - caps at MAX_FEATURES entries (keeps first)
 *  - if input is not an object or is empty, returns empty object
 */
export function sanitizeTaste(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  let count = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (count >= MAX_FEATURES) break;
    const isValidPrefix = VALID_FEATURE_PREFIXES.some((p) => k.startsWith(p));
    if (!isValidPrefix) continue;
    const num = Number(v);
    if (!Number.isFinite(num)) continue;
    out[k] = Math.max(-1, Math.min(1, num));
    count++;
  }
  return out;
}

/** Validate eventCount — whole number 0..1000, default 0. */
export function sanitizeEventCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 0;
  return Math.max(0, Math.min(MAX_EVENT_COUNT, n));
}

/** Taste bonus for one movie.
 *  avgWeight = mean of weights over matched features.
 *  bonus = TASTE_LAMBDA * avgWeight * confidence
 *  confidence = min(1, eventCount / CONFIDENCE_RAMP)
 *  Returns 0 if no overlap or no taste vector.
 */
export function tasteBonus(
  movie: RankableMovie,
  taste: Record<string, number>,
  eventCount: number
): number {
  if (!taste || Object.keys(taste).length === 0) return 0;
  const feats = movieFeatures(movie);
  const matched: number[] = [];
  for (const [k, w] of Object.entries(taste)) {
    if (typeof feats[k] === 'number') matched.push(w);
  }
  if (matched.length === 0) return 0;
  const avg = matched.reduce((a, b) => a + b, 0) / matched.length;
  const confidence = Math.min(1, eventCount / CONFIDENCE_RAMP);
  return TASTE_LAMBDA * avg * confidence;
}