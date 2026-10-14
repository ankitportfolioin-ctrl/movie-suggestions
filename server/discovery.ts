/**
 * TMDB discovery: the primary candidate source when a key is configured.
 *
 * API KEY: free v3 key from https://www.themoviedb.org/settings/api
 *   → set TMDB_API_KEY in .env (server-side only, never client-side).
 * ATTRIBUTION (required by TMDB ToS): "This product uses the TMDB API but
 *   is not endorsed or certified by TMDB." TMDB logo use where reasonable.
 * LICENSING/NOTES: posters/backdrops must be served from image.tmdb.org
 *   (we build URLs that way); cache API responses; do not hotlink beyond
 *   their CDN; respect ~40 req/10s rate limits (we back off to partial or
 *   null results on 429). All failures resolve to null so callers fall
 *   back to the local catalog — discovery never breaks recommendations.
 */
import { MovieItem } from './catalog.js';

export const TMDB_GENRE_IDS: Record<string, number> = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  Horror: 27,
  Mystery: 9648,
  Romance: 10749,
  'Sci-Fi': 878,
  Thriller: 53,
};

export const TMDB_GENRE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(TMDB_GENRE_IDS).map(([name, id]) => [id, name])
);

export const DISCOVERY_LANGUAGE_CODES: Record<string, string> = {
  English: 'en',
  Hindi: 'hi',
  Tamil: 'ta',
  Telugu: 'te',
  Korean: 'ko',
  Japanese: 'ja',
  Spanish: 'es',
  French: 'fr',
};
export interface DiscoveryPrefs {
  genres: string[];
  languages: string[];
  maxRuntime: string;
  highlyRated: boolean;
  recent: boolean;
  classics: boolean;
  family: boolean;
  mature: boolean;
  excludeIds: number[];
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const discoverCache = new Map<string, CacheEntry<MovieItem[]>>();
const detailsCache = new Map<number, CacheEntry<{ runtime: number; genres: string[] }>>();
const DISCOVER_TTL = 10 * 60 * 1000;
const DETAILS_TTL = 24 * 3600 * 1000;
// Circuit breaker: track consecutive failures per prefs-hash
const circuitBreaker = new Map<string, { failures: number; openUntil: number }>();
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_DURATION = 5 * 60 * 1000; // 5 minutes

async function fetchJson(url: string, timeoutMs = 3000): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MovieNightPicker/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429) return null; // rate limited → caller degrades gracefully
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function checkCircuitBreaker(cacheKey: string): boolean {
  const state = circuitBreaker.get(cacheKey);
  if (!state) return false;
  if (state.openUntil > Date.now()) return true; // circuit open
  // Circuit closed, reset failures
  if (state.failures > 0) {
    circuitBreaker.set(cacheKey, { failures: 0, openUntil: 0 });
  }
  return false;
}

function recordFailure(cacheKey: string) {
  const state = circuitBreaker.get(cacheKey) || { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_OPEN_DURATION;
    state.failures = 0;
    console.warn(`[discovery] Circuit breaker OPEN for ${cacheKey} (5 min)`);
  }
  circuitBreaker.set(cacheKey, state);
}

function recordSuccess(cacheKey: string) {
  const state = circuitBreaker.get(cacheKey);
  if (state && state.failures > 0) {
    circuitBreaker.set(cacheKey, { failures: 0, openUntil: 0 });
  }
}

function mapDiscoverHit(hit: any): MovieItem | null {
  if (!hit || typeof hit.id !== 'number' || typeof hit.title !== 'string') return null;
  const year = typeof hit.release_date === 'string' ? parseInt(hit.release_date.slice(0, 4), 10) : NaN;
  const genres = Array.isArray(hit.genre_ids)
    ? hit.genre_ids.map((id: number) => TMDB_GENRE_NAMES[id]).filter(Boolean)
    : [];
  return {
    id: hit.id,
    title: hit.title,
    year: isNaN(year) ? 2000 : year,
    genres,
    runtime: 0, // unknown until /movie/{id}; enriched below
    rating: typeof hit.vote_average === 'number' ? Math.round(hit.vote_average * 10) / 10 : 0,
    voteCount: typeof hit.vote_count === 'number' ? hit.vote_count : 0,
    popularity: typeof hit.popularity === 'number' ? hit.popularity : 0,
    overview: typeof hit.overview === 'string' ? hit.overview : '',
    posterUrl: hit.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : '',
    language: typeof hit.original_language === 'string' ? hit.original_language : 'en',
    isMature: hit.adult === true,
    isHiddenGem:
      (hit.vote_average || 0) >= 7 && (hit.vote_count || 0) >= 50 && (hit.vote_count || 0) <= 2500,
    providers: [],
  };
}

function buildParams(prefs: DiscoveryPrefs, apiKey: string, sort: string): URLSearchParams {
  const q = new URLSearchParams();
  q.set('api_key', apiKey);
  q.set('sort_by', sort);
  q.set('include_adult', prefs.family ? 'false' : prefs.mature ? 'true' : 'false');
  q.set('vote_count.gte', '50');
  if (prefs.highlyRated) q.set('vote_average.gte', '7.0');

  const names =
    prefs.genres.includes('Surprise me') || prefs.genres.length === 0
      ? []
      : prefs.genres.filter((g) => g !== 'Surprise me');
  if (prefs.family) {
    q.set('with_genres', '10751|16');
    q.set('without_genres', '27,53,80');
  } else if (names.length > 0) {
    const ids = names.map((n) => TMDB_GENRE_IDS[n]).filter(Boolean);
    if (ids.length > 0) q.set('with_genres', ids.join('|'));
  }

  if (prefs.languages.length > 0 && !prefs.languages.includes('Any')) {
    const codes = prefs.languages.map((l) => DISCOVERY_LANGUAGE_CODES[l]).filter(Boolean);
    if (codes.length > 0) q.set('with_original_language', codes.join('|'));
  }

  if (prefs.recent) q.set('primary_release_date.gte', '2021-01-01');
  if (prefs.classics) q.set('primary_release_date.lte', '1999-12-31');
  return q;
}

/**
 * Broad candidate retrieval: paginated discover across two sort orders
 * (popular + top-rated) with dedupe. Returns null when TMDB is
 * unavailable so callers use the local catalog instead.
 */
export async function discoverCandidates(
  prefs: DiscoveryPrefs,
  apiKey: string
): Promise<MovieItem[] | null> {
  if (!apiKey) return null;
  const cacheKey = JSON.stringify([prefs, 'v1']);
  const now = Date.now();
  const cached = discoverCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data;
  if (checkCircuitBreaker(cacheKey)) return null;

  const seen = new Map<number, MovieItem>();
  const sorts = ['popularity.desc', 'vote_average.desc'];

  // Run both sort orders in parallel for lower latency
  const sortPromises = sorts.map(async (sort) => {
    const localSeen = new Map<number, MovieItem>();
    for (let page = 1; page <= 2; page++) {
      const q = buildParams(prefs, apiKey, sort);
      q.set('page', String(page));
      if (sort === 'vote_average.desc') q.set('vote_count.gte', '300');
      const data = await fetchJson(`https://api.themoviedb.org/3/discover/movie?${q.toString()}`);
      const results = data && Array.isArray(data.results) ? data.results : [];
      if (results.length === 0) break;
      for (const hit of results) {
        if (prefs.excludeIds.includes(hit?.id)) continue;
        const mapped = mapDiscoverHit(hit);
        if (mapped && mapped.posterUrl && !localSeen.has(mapped.id)) localSeen.set(mapped.id, mapped);
      }
      if (localSeen.size >= 20) break; // per-sort limit
      if (page >= (data.total_pages || 1)) break;
    }
    return localSeen;
  });

  const sortResults = await Promise.all(sortPromises);
  for (const localSeen of sortResults) {
    for (const [id, movie] of localSeen) {
      if (!seen.has(id)) seen.set(id, movie);
    }
    if (seen.size >= 40) break;
  }

  if (seen.size === 0) {
    recordFailure(cacheKey);
    return null;
  }
  recordSuccess(cacheKey);
  const items = [...seen.values()];
  discoverCache.set(cacheKey, { data: items, expiresAt: now + DISCOVER_TTL });
  return items;
}

/**
 * Fill in runtime (+ exact genres) for candidates via /movie/{id}.
 * Bounded (default 15) and cached; failures keep the candidate with
 * runtime 0 (callers treat 0 as "unknown", never as "short").
 */
export async function enrichRuntimes(
  items: MovieItem[],
  apiKey: string,
  limit = 15
): Promise<Map<number, { runtime: number; genres: string[] }>> {
  const out = new Map<number, { runtime: number; genres: string[] }>();
  const now = Date.now();
  const missing = items.filter((m) => !m.runtime || m.runtime <= 0).slice(0, limit);
  await Promise.all(
    missing.map(async (m) => {
      const cached = detailsCache.get(m.id);
      if (cached && cached.expiresAt > now) {
        out.set(m.id, cached.data);
        return;
      }
      const data = await fetchJson(
        `https://api.themoviedb.org/3/movie/${m.id}?api_key=${apiKey}`
      );
      if (!data) return;
      const entry = {
        runtime: typeof data.runtime === 'number' && data.runtime > 0 ? data.runtime : 0,
        genres: Array.isArray(data.genres)
          ? data.genres.map((g: any) => g?.name).filter((n: any) => typeof n === 'string')
          : [],
      };
      detailsCache.set(m.id, { data: entry, expiresAt: now + DETAILS_TTL });
      out.set(m.id, entry);
    })
  );
  return out;
}

/**
 * Title search (exact, partial, year-disambiguated; TMDB tolerates
 * minor misspellings server-side). Returns top mapped hits.
 */
export async function searchTitles(
  query: string,
  year: number | undefined,
  apiKey: string,
  limit = 5
): Promise<MovieItem[] | null> {
  if (!apiKey || !query.trim()) return null;
  const q = new URLSearchParams({ api_key: apiKey, query: query.trim(), include_adult: 'false' });
  if (year) q.set('year', String(year));
  const data = await fetchJson(`https://api.themoviedb.org/3/search/movie?${q.toString()}`);
  if (!data || !Array.isArray(data.results)) return null;
  return data.results
    .map(mapDiscoverHit)
    .filter((m: MovieItem | null): m is MovieItem => m !== null)
    .slice(0, limit);
}
