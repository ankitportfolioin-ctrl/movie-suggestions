/**
 * Request validation + sanitization for POST /api/recommend.
 * Pure and fully unit-testable: no Express dependency.
 */
import type { RecommendParams } from './omdb.js';

export const VALID_MOODS = new Set([
  'Happy', 'Relaxed', 'Tired', 'Stressed',
  'Romantic', 'Adventurous', 'Curious', 'Sad',
]);

export const VALID_GENRES = new Set([
  'Surprise me', 'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror', 'Mystery',
  'Romance', 'Sci-Fi', 'Thriller',
]);

export const VALID_AUDIENCES = new Set([
  'Just me', 'Partner', 'Friends', 'Family with kids',
]);

export const VALID_RUNTIMES = new Set([
  'Under 90 min', 'Under 2 hours', 'Under 2.5 hours', 'Any length',
]);

export const VALID_LANGUAGES = new Set([
  'Any', 'English', 'Hindi', 'Tamil', 'Telugu',
  'Korean', 'Japanese', 'Spanish', 'French',
]);

export type ValidationResult =
  | { ok: true; params: RecommendParams }
  | { ok: false; error: string };

export function validateRecommendBody(body: any): ValidationResult {
  const { mood, genres, audience, maxRuntime, languages, preferences, note, excludeIds, taste } =
    body || {};

  if (!mood || typeof mood !== 'string' || !VALID_MOODS.has(mood)) {
    return { ok: false, error: 'Invalid input parameters' };
  }
  if (!Array.isArray(genres) || genres.some((g: any) => typeof g !== 'string' || !VALID_GENRES.has(g))) {
    return { ok: false, error: 'Invalid input parameters' };
  }
  if (!audience || typeof audience !== 'string' || !VALID_AUDIENCES.has(audience)) {
    return { ok: false, error: 'Invalid input parameters' };
  }
  if (!maxRuntime || typeof maxRuntime !== 'string' || !VALID_RUNTIMES.has(maxRuntime)) {
    return { ok: false, error: 'Invalid input parameters' };
  }
  if (!Array.isArray(languages) || languages.some((l: any) => typeof l !== 'string' || !VALID_LANGUAGES.has(l))) {
    return { ok: false, error: 'Invalid input parameters' };
  }

  const sanitizedNote = typeof note === 'string' ? note.trim().slice(0, 200) : '';

  return {
    ok: true,
    params: {
      mood,
      genres: genres.slice(0, 3),
      audience,
      maxRuntime,
      languages,
      preferences: {
        highlyRated: Boolean(preferences?.highlyRated),
        hiddenGems: Boolean(preferences?.hiddenGems),
        recent: Boolean(preferences?.recent),
        classics: Boolean(preferences?.classics),
        // If audience is Family with kids, mature MUST be false
        mature: audience === 'Family with kids' ? false : Boolean(preferences?.mature),
      },
      note: sanitizedNote,
      excludeIds: Array.isArray(excludeIds) ? excludeIds.filter((id) => typeof id === 'number').slice(0, 100) : [],
      taste,
    },
  };
}