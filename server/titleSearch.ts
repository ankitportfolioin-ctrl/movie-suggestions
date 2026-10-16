/**
 * Exact-title search shared by server.ts and api/index.ts.
 * Pure-ish core (injectable fetch + catalog) so every case is unit-testable:
 * provider outage is a 502 retryable error, never a masked empty result.
 */
import { FALLBACK_CATALOG } from './catalog.js';
import type { MovieItem } from './catalog.js';
import { normalizeTitle } from './omdb.js';
import { toLocalImg } from './img.js';

export interface TitleSuggestion {
  id: number;
  title: string;
  year: number;
  mediaType: string;
  genres: string[];
  runtime: number;
  rating: number;
  overview: string;
  posterUrl: string;
  language: string;
}

export interface TitleSearchDeps {
  tmdbKey?: string;
  fetchFn?: typeof fetch;
  catalog?: MovieItem[];
}

const UPSTREAM_DOWN = {
  status: 502,
  body: { error: 'Title search is temporarily unavailable. Please try again.', retryable: true },
};

export async function searchTitles(
  rawQuery: unknown, deps: TitleSearchDeps = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const query = typeof rawQuery === 'string' ? rawQuery.trim().replace(/\s+/g, ' ') : '';
  if (!query || query.length > 120) return { status: 400, body: { error: 'Invalid query' } };
  if (query.length < 2) return { status: 400, body: { error: 'Type at least 2 characters' } };

  const key = deps.tmdbKey?.trim();
  if (!key) {
    const catalog = deps.catalog ?? FALLBACK_CATALOG;
    const normQuery = normalizeTitle(query);
    const results = catalog
      .filter((m) => normalizeTitle(m.title).includes(normQuery) || normQuery.includes(normalizeTitle(m.title)))
      .slice(0, 10)
      .map(toSuggestion);
    return { status: 200, body: { results, source: 'local' } };
  }

  const fetchFn = deps.fetchFn ?? fetch;
  let searchRes: Response;
  try {
    searchRes = await fetchFn(
      `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(query)}&include_adult=false`,
      { headers: { 'User-Agent': 'MovieNightPicker/1.0' }, signal: AbortSignal.timeout(3000) },
    ) as Response;
  } catch {
    return UPSTREAM_DOWN;
  }
  if (!searchRes.ok) return UPSTREAM_DOWN;

  let data: { results?: unknown[] };
  try {
    data = (await searchRes.json()) as { results?: unknown[] };
  } catch {
    return UPSTREAM_DOWN;
  }
  const results = ((data && Array.isArray(data.results) ? data.results : []) as Record<string, unknown>[])
    .filter((m) => typeof m.poster_path === 'string' && m.poster_path && typeof m.release_date === 'string' && m.release_date)
    .slice(0, 10)
    .map((m) => ({
      id: m.id as number,
      title: String(m.title ?? m.original_title ?? ''),
      year: parseInt(String(m.release_date).slice(0, 4), 10),
      mediaType: 'movie',
      genres: [] as string[],
      runtime: 0,
      rating: typeof m.vote_average === 'number' ? Math.round((m.vote_average as number) * 10) / 10 : 0,
      overview: typeof m.overview === 'string' ? (m.overview as string) : '',
      posterUrl: toLocalImg(`https://image.tmdb.org/t/p/w500${m.poster_path as string}`) ||
        `https://image.tmdb.org/t/p/w500${m.poster_path as string}`,
      language: (m.original_language as string) || 'en',
    }));
  return { status: 200, body: { results, source: 'tmdb' } };
}

function toSuggestion(m: MovieItem): TitleSuggestion {
  return {
    id: m.id, title: m.title, year: m.year, mediaType: 'movie', genres: m.genres,
    runtime: m.runtime, rating: m.rating, overview: m.overview,
    posterUrl: toLocalImg(m.posterUrl) || m.posterUrl, language: m.language,
  };
}
