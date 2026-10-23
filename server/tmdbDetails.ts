/**
 * TMDB title details: where to watch, cast, director/creators, trailer.
 * One request per title (append_to_response), cached in memory, hard 3s cap,
 * never throws - a failure just means the page/card renders without the extras.
 *
 * "Where to watch" data is provided by JustWatch through TMDB; their terms
 * require visible attribution (rendered on the title page).
 * Auth: TMDB_API_KEY may be a v3 key (?api_key=) or a v4 read token (Bearer).
 */

export interface WatchProvider {
  name: string;
  logoUrl: string; // https://image.tmdb.org/t/p/w92/... (proxied by toLocalImg at the edge)
  type: 'Stream' | 'Free' | 'Rent' | 'Buy';
  url?: string;
}

export interface CastMember { name: string; character: string }

export interface TitleExtras {
  providers: WatchProvider[];
  cast: CastMember[];
  director: string | null;
  trailerUrl: string | null;
  region: string;
}

interface CacheEntry { data: TitleExtras | null; expiresAt: number }
const cache = new Map<string, CacheEntry>();
const TTL_OK = 6 * 3600 * 1000;   // availability changes; 6h keeps us well inside TMDB limits
const TTL_FAIL = 5 * 60 * 1000;   // retry failures soon, but don't hammer
const CACHE_CAP = 1000;

export function resolveRegion(input?: string | null): string {
  const r = (input || process.env.WATCH_REGION || process.env.WATCHMODE_REGION || 'US').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(r) ? r : 'US';
}

const TYPE_ORDER: Record<string, number> = { Stream: 0, Free: 1, Rent: 2, Buy: 3 };

/** Pure: TMDB payload -> TitleExtras (unit-tested, no network). */
export function parseDetails(json: any, region: string): TitleExtras {
  const reg = json?.['watch/providers']?.results?.[region];
  const providers: WatchProvider[] = [];
  const seen = new Set<string>();
  const add = (list: any, type: WatchProvider['type']) => {
    if (!Array.isArray(list)) return;
    for (const p of list) {
      if (!p?.provider_name || !p?.logo_path) continue;
      const key = `${p.provider_name}|${type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      providers.push({
        name: String(p.provider_name),
        logoUrl: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
        type,
        url: typeof reg?.link === 'string' ? reg.link : undefined,
      });
    }
  };
  add(reg?.flatrate, 'Stream');
  add(reg?.free, 'Free');
  add(reg?.ads, 'Free');
  add(reg?.rent, 'Rent');
  add(reg?.buy, 'Buy');
  providers.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);

  const cast: CastMember[] = (Array.isArray(json?.credits?.cast) ? json.credits.cast : [])
    .filter((c: any) => c?.name)
    .slice(0, 8)
    .map((c: any) => ({ name: String(c.name), character: String(c.character || '') }));

  const directors = (Array.isArray(json?.credits?.crew) ? json.credits.crew : [])
    .filter((c: any) => c?.job === 'Director' && c?.name).map((c: any) => String(c.name));
  const creators = (Array.isArray(json?.created_by) ? json.created_by : [])
    .filter((c: any) => c?.name).map((c: any) => String(c.name));
  const director = [...new Set(directors.length ? directors : creators)].slice(0, 2).join(', ') || null;

  const vids: any[] = Array.isArray(json?.videos?.results) ? json.videos.results : [];
  const yt = vids.filter((v) => v?.site === 'YouTube' && /^[\w-]{6,20}$/.test(v?.key ?? ''));
  const trailer = yt.find((v) => v.type === 'Trailer' && v.official) || yt.find((v) => v.type === 'Trailer') || yt[0];
  const trailerUrl = trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null;

  return { providers, cast, director, trailerUrl, region };
}

async function fetchWithTimeout(url: string, headers: Record<string, string>, ms: number): Promise<any | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getTitleExtras(
  tmdbId: number, kind: 'movie' | 'tv', regionIn?: string | null, timeoutMs = 3000,
): Promise<TitleExtras | null> {
  const key = process.env.TMDB_API_KEY?.trim();
  if (!key || !Number.isInteger(tmdbId) || tmdbId <= 0) return null;
  const region = resolveRegion(regionIn);
  const ck = `${kind}:${tmdbId}:${region}`;
  const hit = cache.get(ck);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const bearer = key.length > 60 || key.startsWith('eyJ');
  const qs = new URLSearchParams({ append_to_response: 'credits,videos,watch/providers', language: 'en-US' });
  if (!bearer) qs.set('api_key', key);
  const json = await fetchWithTimeout(
    `https://api.themoviedb.org/3/${kind}/${tmdbId}?${qs.toString()}`,
    bearer ? { Authorization: `Bearer ${key}`, Accept: 'application/json' } : { Accept: 'application/json' },
    timeoutMs,
  );
  const data = json ? parseDetails(json, region) : null;
  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value as string);
  cache.set(ck, { data, expiresAt: Date.now() + (data ? TTL_OK : TTL_FAIL) });
  return data;
}

/**
 * Attach streaming providers to final picks, in parallel, under one shared
 * deadline so "where to watch" can never slow a recommendation noticeably.
 */
export async function attachProviders<T extends { id: number; mediaType?: string; providers: any[] }>(
  picks: T[], regionIn?: string | null, budgetMs = 2500,
): Promise<void> {
  if (!process.env.TMDB_API_KEY?.trim() || picks.length === 0) return;
  await Promise.race([
    Promise.all(picks.map(async (p) => {
      const kind = /series|tv/i.test(p.mediaType || '') ? 'tv' : 'movie';
      const x = await getTitleExtras(p.id, kind, regionIn, budgetMs);
      if (x?.providers.length) p.providers = x.providers.slice(0, 6);
    })),
    new Promise<void>((r) => setTimeout(r, budgetMs)),
  ]);
}
