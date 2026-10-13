import type { RecommendParams } from '../server/omdb.js';

export function baseParams(overrides: Partial<RecommendParams> = {}): RecommendParams {
  return {
    mood: 'Relaxed',
    genres: ['Surprise me'],
    audience: 'Just me',
    maxRuntime: 'Any length',
    languages: ['Any'],
    preferences: {},
    note: '',
    excludeIds: [],
    ...overrides,
  };
}

export function titles(items: { movie: { title: string } }[]): string[] {
  return items.map((i) => i.movie.title);
}
