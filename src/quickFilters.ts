/**
 * Pure helpers behind the one-tap filter bar (results page) and the home
 * Movies/Series switch. Kept free of React so they are unit-tested.
 */
export const TYPE_OPTIONS = ['Movie', 'Series', 'Any'] as const;
export const MOOD_OPTIONS_QUICK = ['Surprise me', 'Funny', 'Feel-good', 'Suspenseful', 'Mind-bending', 'Emotional', 'Adventurous'] as const;
export const AUDIENCE_OPTIONS = ['Just me', 'Partner', 'Friends', 'Family with kids'] as const;
export const RUNTIME_OPTIONS = ['Under 90 min', 'Under 2 hours', 'Under 2.5 hours', 'Any length'] as const;
export const GENRE_OPTIONS = [
  'Action', 'Comedy', 'Drama', 'Thriller', 'Romance', 'Horror',
  'Sci-Fi', 'Animation', 'Family', 'Mystery', 'Crime', 'Fantasy',
] as const;

/** API media kinds -> the label of the chip that should look selected. */
export function typesToLabel(types?: string[]): string {
  const t = (types ?? ['movie']).map((x) => x.toLowerCase());
  if (t.length === 0) return 'Movie';
  if (t.length > 1) return 'Any';
  if (t[0] === 'series') return 'Series';
  if (t[0] === 'short') return 'Short film';
  return 'Movie';
}

/** Chip label -> API kinds. */
export function labelToTypes(label: string): string[] {
  switch (label) {
    case 'Series': return ['series'];
    case 'Short film': return ['short'];
    case 'Any': return ['movie', 'series', 'short'];
    default: return ['movie'];
  }
}

export function normalizeAudience(a?: string): string {
  return !a || a === 'Family / kids' ? (a ? 'Family with kids' : 'Just me') : a;
}

/** Multi-select genre toggle, capped (the API accepts at most 3). */
export function toggleGenre(current: string[], genre: string, max = 3): string[] {
  const base = current.filter((g) => g !== 'Surprise me');
  if (base.includes(genre)) return base.filter((g) => g !== genre);
  return [...base, genre].slice(-max);
}
