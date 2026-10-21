/**
 * Watchmode integration for live "where to watch" streaming availability.
 *
 * Catalog movie ids are TMDB movie ids, so titles resolve exactly via
 * Watchmode search (search_field=tmdb_movie_id) with no title ambiguity.
 *
 * All failures fall back to the catalog's static providers: this module
 * never throws for network/API problems, it just returns the picks
 * unchanged so recommendations always work with or without Watchmode.
 */

interface Provider {
  name: string;
  logoUrl: string;
  type?: string;
  /** Title-specific provider page from Watchmode (when the source offers one). */
  url?: string;
}

interface MoviePickLike {
  id: number; // TMDB movie id
  title: string;
  year: number;
  providers: Provider[];
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const titleIdCache = new Map<number, CacheEntry<number | null>>();
const sourcesCache = new Map<string, CacheEntry<WatchmodeSource[]>>();
const directoryCache = new Map<string, CacheEntry<Map<number, { name: string; logo: string }>>>();

const TITLE_TTL = 7 * 24 * 3600 * 1000; // 7 days: TMDB id -> Watchmode id never changes
const SOURCES_TTL = 6 * 3600 * 1000; // 6 hours: availability changes often
const DIRECTORY_TTL = 24 * 3600 * 1000; // 24 hours: source names/logos are stable

interface WatchmodeSource {
  source_id: number;
  name: string;
  type: string; // sub | rent | buy | free | tve
  region: string;
  web_url?: string;
}

const TYPE_LABELS: Record<string, string> = {
  sub: 'Stream',
  free: 'Free',
  tve: 'TV',
  rent: 'Rent',
  buy: 'Buy',
};

// Subscription/free first: most actionable for "press play tonight".
const TYPE_PRIORITY: Record<string, number> = {
  sub: 0,
  free: 1,
  tve: 2,
  rent: 3,
  buy: 4,
};

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MovieNightPicker/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Resolve a TMDB movie id to a Watchmode title id (cached).
 * Falls back to a name+year search because Watchmode's TMDB linkage
 * is occasionally stale (e.g. Office Space is tmdb 1104 for us,
 * tmdb 1542 for them).
 */
async function resolveTitleId(
  tmdbId: number,
  title: string,
  year: number,
  apiKey: string
): Promise<number | null> {
  const now = Date.now();
  const cached = titleIdCache.get(tmdbId);
  if (cached && cached.expiresAt > now) return cached.data;

  let titleId: number | null = null;

  const exact = await fetchJson(
    `https://api.watchmode.com/v1/search/?apiKey=${apiKey}&search_field=tmdb_movie_id&search_value=${tmdbId}`
  );
  const exactResults = exact?.title_results;
  if (Array.isArray(exactResults) && exactResults[0]?.id) {
    titleId = exactResults[0].id;
  } else {
    const byName = await fetchJson(
      `https://api.watchmode.com/v1/search/?apiKey=${apiKey}&search_field=name&search_value=${encodeURIComponent(title)}&types=movie`
    );
    const nameResults = byName?.title_results;
    if (Array.isArray(nameResults)) {
      const match = nameResults.find(
        (r: any) => r && typeof r.id === 'number' && r.year === year
      );
      if (match) titleId = match.id;
    }
  }

  titleIdCache.set(tmdbId, { data: titleId, expiresAt: now + TITLE_TTL });
  return titleId;
}

/** Fetch streaming sources for a title in a region (cached). */
async function getSources(
  titleId: number,
  region: string,
  apiKey: string
): Promise<WatchmodeSource[]> {
  const key = `${titleId}_${region}`;
  const now = Date.now();
  const cached = sourcesCache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  const data = await fetchJson(
    `https://api.watchmode.com/v1/title/${titleId}/sources/?apiKey=${apiKey}&regions=${region}`
  );
  const sources = Array.isArray(data) ? data : [];
  sourcesCache.set(key, { data: sources, expiresAt: now + SOURCES_TTL });
  return sources;
}

/** Full source directory for a region: id -> { name, logo } (cached). */
async function getDirectory(
  region: string,
  apiKey: string
): Promise<Map<number, { name: string; logo: string }>> {
  const now = Date.now();
  const cached = directoryCache.get(region);
  if (cached && cached.expiresAt > now) return cached.data;

  const data = await fetchJson(
    `https://api.watchmode.com/v1/sources/?apiKey=${apiKey}&regions=${region}`
  );
  const dir = new Map<number, { name: string; logo: string }>();
  if (Array.isArray(data)) {
    for (const s of data) {
      if (s && typeof s.id === 'number' && typeof s.name === 'string') {
        dir.set(s.id, { name: s.name, logo: typeof s.logo_100px === 'string' ? s.logo_100px : '' });
      }
    }
  }
  directoryCache.set(region, { data: dir, expiresAt: now + DIRECTORY_TTL });
  return dir;
}

/**
 * Attach live Watchmode streaming providers to each pick.
 * Picks keep their catalog providers whenever live data is
 * unavailable or a title has no sources in the region.
 */
export async function attachLiveProviders<T extends MoviePickLike>(
  picks: T[],
  apiKey: string,
  region: string
): Promise<T[]> {
  if (!apiKey || picks.length === 0) return picks;

  const directory = await getDirectory(region, apiKey);

  const enriched = await Promise.all(
    picks.map(async (pick) => {
      try {
        const titleId = await resolveTitleId(pick.id, pick.title, pick.year, apiKey);
        if (titleId === null) return pick;

        const sources = await getSources(titleId, region, apiKey);
        if (sources.length === 0) return pick;

        // Sort by actionability, dedupe by source keeping best type.
        const ranked = [...sources].sort(
          (a, b) => (TYPE_PRIORITY[a.type] ?? 9) - (TYPE_PRIORITY[b.type] ?? 9)
        );
        const seen = new Set<number>();
        const providers: Provider[] = [];
        for (const s of ranked) {
          if (typeof s.source_id !== 'number' || seen.has(s.source_id)) continue;
          seen.add(s.source_id);
          const info = directory.get(s.source_id);
          const webUrl =
            typeof s.web_url === 'string' && /^https?:\/\//i.test(s.web_url) ? s.web_url : undefined;
          providers.push({
            name: info?.name || s.name || 'Unknown',
            logoUrl: info?.logo || '',
            type: TYPE_LABELS[s.type] || s.type,
            url: webUrl,
          });
          if (providers.length >= 4) break;
        }

        return providers.length > 0 ? { ...pick, providers } : pick;
      } catch {
        return pick;
      }
    })
  );

  return enriched;
}
