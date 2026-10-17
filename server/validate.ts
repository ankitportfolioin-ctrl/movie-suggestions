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
  // Series-only choice: episode-length cap stays open, seasons capped at 1.
  'Miniseries (1 season)',
]);

export const VALID_TYPES = ['movie', 'short', 'series'] as const;

export const VALID_LANGUAGES = new Set([
  'Any', 'English', 'Hindi', 'Tamil', 'Telugu',
  'Korean', 'Japanese', 'Spanish', 'French',
]);

export type ValidationResult =
  | { ok: true; params: RecommendParams }
  | { ok: false; error: string };

// Valid values for fine-tune options
export const VALID_TONES = new Set(['Light & fun', 'Thoughtful', 'Intense', 'Dark', 'Uplifting']);
export const VALID_PACE = new Set(['Slow-burn', 'Medium', 'Fast']);
export const VALID_INTENSITY = new Set(['No violence', 'Mild', 'Moderate', 'Any']);
export const VALID_HUMOR = new Set(['Slapstick', 'Witty', 'Dark comedy', 'Satirical']);

export function validateRecommendBody(body: any): ValidationResult {
  const { mood, genres, audience, maxRuntime, languages, preferences, note, excludeIds, taste, referenceIds, types } =
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

  // Validate referenceIds: max 3, each must match tt + digits pattern
  let sanitizedReferenceIds: string[] = [];
  if (Array.isArray(referenceIds)) {
    sanitizedReferenceIds = referenceIds
      .filter((id) => typeof id === 'string' && /^tt\d+$/.test(id))
      .slice(0, 3);
  }

  // Media kinds: unknown values are dropped; default is movies-only.
  const sanitizedTypes = Array.isArray(types)
    ? [...new Set(types.filter((t: any) => typeof t === 'string' && (VALID_TYPES as readonly string[]).includes(t)))].slice(0, 3)
    : [];
  const requestTypes = sanitizedTypes.length > 0 ? sanitizedTypes : ['movie'];

  // Validate fine-tune options (known values only, otherwise ignored)
  const tones = Array.isArray(preferences?.tones)
    ? preferences.tones.filter((t: any) => typeof t === 'string' && VALID_TONES.has(t)).slice(0, 2)
    : undefined;
  const pace = typeof preferences?.pace === 'string' && VALID_PACE.has(preferences.pace)
    ? preferences.pace
    : undefined;
  const intensity = typeof preferences?.intensity === 'string' && VALID_INTENSITY.has(preferences.intensity)
    ? preferences.intensity
    : undefined;
  const humorStyle = typeof preferences?.humorStyle === 'string' && VALID_HUMOR.has(preferences.humorStyle)
    ? preferences.humorStyle
    : undefined;

  const sanitizedNote = typeof note === 'string' ? note.trim().slice(0, 200) : '';

  return {
    ok: true,
    params: {
      mood,
      genres: genres.slice(0, 3),
      audience,
      maxRuntime,
      languages,
      types: requestTypes,
      preferences: {
        highlyRated: Boolean(preferences?.highlyRated),
        hiddenGems: Boolean(preferences?.hiddenGems),
        recent: Boolean(preferences?.recent),
        classics: Boolean(preferences?.classics),
        // If audience is Family with kids, mature MUST be false
        mature: audience === 'Family with kids' ? false : Boolean(preferences?.mature),
        tones,
        pace,
        intensity,
        humorStyle,
      },
      note: sanitizedNote,
      excludeIds: Array.isArray(excludeIds) ? excludeIds.filter((id) => typeof id === 'number').slice(0, 100) : [],
      referenceIds: sanitizedReferenceIds,
      taste,
    },
  };
}