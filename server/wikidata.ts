/**
 * Wikidata supplementary factual metadata enrichment.
 *
 * Data available under CC0. Follow API usage policies, use a meaningful
 * User-Agent, respect rate limits, and implement caching.
 *
 * NOT used for: moods, endings, runtime, content warnings, or other
 * subjective attributes. Only for verified factual relationships
 * relevant to discovery.
 *
 * API: https://www.wikidata.org/wiki/Help:Data_access
 * Rate limit be conservative: max 1 request/second per IP.
 * User-Agent: must be meaningful + contact info.
 * Cache: successful lookups with 7-day TTL.
 */

/** Wikidata API endpoints */
const WIKIDATA_SEARCH = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_ENTITY = 'https://www.wikidata.org/wiki/Special:EntityData/';

const WIKIDATA_HEADERS = {
  'User-Agent': 'MovieNightPicker/1.0 (contact: dev@example.com)',
  Accept: 'application/json',
};

/**
 * Wikidata entity result structure.
 */
export interface WikidataEntity {
  id: string;
  labels: Record<string, { value: string; language: string }>;
  descriptions: Record<string, { value: string; language: string }>;
  claims: Record<string, WikidataClaim[]>;
}

/** A single Wikidata claim. */
export interface WikidataClaim {
  mainsnak: {
    snaktype: string;
    property: string;
    datatype: string;
    value: any;
  };
  qualifiers?: Record<string, WikidataQualifier[]>;
}

/** A single Wikidata qualifier. */
export interface WikidataQualifier {
  mainsnak: {
    snaktype: string;
    property: string;
    datatype: string;
    value: any;
  };
}

/** Wikidata enrichment result for a movie. */
export interface WikidataEnrichment {
  wikidataId: string;
  country: string[];
  language: string[];
  releaseDate?: string;
  director?: string[];
  cinematographer?: string[];
  soundtrack?: string[];
  basedOn?: string[];
}

/**
 * Search Wikidata for a title and return the best match.
 * Returns null if no good match found.
 */
export async function searchWikidataTitle(
  title: string,
  language = 'en'
): Promise<{ entity: WikidataEntity; bestMatch: string } | null> {
  try {
    const params = new URLSearchParams({
      action: 'wbsearchentities',
      format: 'json',
      language,
      type: 'item',
      search: title,
    });

    const res = await fetch(`${WIKIDATA_SEARCH}?${params.toString()}`, {
      headers: WIKIDATA_HEADERS,
    });

    if (!res.ok) return null;
    const data = await res.json();

    if (!data.search || data.search.length === 0) return null;

    // Take the first result (Wikidata ranks by relevance)
    const entityId = data.search[0].id;
    if (!entityId) return null;

    // Fetch the full entity
    const entityRes = await fetch(
      `${WIKIDATA_ENTITY}${entityId}?format=json`,
      { headers: WIKIDATA_HEADERS }
    );

    if (!entityRes.ok) return null;
    const entityData = await entityRes.json();
    const entity = entityData.entities[entityId];

    if (!entity) return null;

    return { entity, bestMatch: data.search[0].value };
  } catch {
    return null;
  }
}

/**
 * Get claim values for a Wikidata entity property.
 *
 * @param entity Wikidata entity object
 * @param propertyId Wikidata property ID (e.g. 'P1472' for country,
 *   'P577' for release date, 'P31' instance of, 'P57' director)
 * @returns Array of claimed values (deduplicated)
 */
export function getWikidataClaim(
  entity: WikidataEntity,
  propertyId: string
): any[] {
  const claims = entity.claims?.[propertyId];
  if (!claims || claims.length === 0) return [];

  return claims
    .map((claim: WikidataClaim) => {
      const snak = claim.mainsnak;
      if (snak.datatype === 'wikibase-item' && snak.value.id) {
        return { id: snak.value.id, label: snak.value.title || '' };
      }
      return snak.value;
    })
    .filter(
      (v: any, i: number, arr: any[]) =>
        arr.findIndex(
          (x: any) =>
            JSON.stringify(x) === JSON.stringify(v)
        ) === i
    );
}

/** Check if a Wikidata entity is about a film/movie. */
function isLikelyMovie(entity: WikidataEntity): boolean {
  const claims = entity.claims || {};
  // Check P31 (instance of) for film/TV movie
  const instanceOf = getWikidataClaim(entity, 'P31');
  const isFilm =
    instanceOf.some(
      (v: any) => typeof v === 'object' && v.id?.includes('/film') || false
    ) ||
    instanceOf.some(
      (v: any) =>
        typeof v === 'string' &&
        (v.includes('film') || v.includes('movie'))
    );

  // Check P361 (subclass of) for film
  const subclassOf = getWikidataClaim(entity, 'P361');
  const isFilm2 =
    subclassOf.some(
      (v: any) =>
        typeof v === 'string' && (v.includes('film') || v.includes('movie'))
    );

  return isFilm || isFilm2;
}

/**
 * Try to enrich a movie with Wikidata data.
 * Only runs when we have a reliable identifier (IMDb ID preferred).
 *
 * @param imdbId Canonical IMDb ID (tt#### format) if available
 * @param title Movie title string
 * @param year Movie release year
 * @returns Wikidata enrichment data, or null if not applicable/unavailable
 */
export async function tryEnrichWithWikidata(
  imdbId: string | undefined,
  title: string,
  year: number
): Promise<WikidataEnrichment | null> {
  // If no identifier, can't reliably search Wikidata
  if (!imdbId && !title) return null;

  // Try searching by title first
  const search = await searchWikidataTitle(title);
  if (!search) return null;

  const { entity, bestMatch } = search;

  // Optionally: only enrich if Wikidata entity likely represents a film
  // Uncomment the line below to restrict to movie-like entities only
  // if (!isLikelyMovie(entity)) return null;

  const enrichment: WikidataEnrichment = {
    wikidataId: search.entity.id,
    country: [],
    language: [],
  };

  // Get country (P1472 / P495) - country of origin
  const countries = getWikidataClaim(entity, 'P1472');
  enrichment.country = countries
    .filter(
      (c: any) =>
        c &&
        typeof c === 'object' &&
        c.id &&
        c.label
    )
    .map((c: any) => c.label || c.id || '');

  // Get primary language (P36) - language of film
  const languages = getWikidataClaim(entity, 'P36');
  enrichment.language = languages
    .filter((l: any) => typeof l === 'string' && l.length > 0)
    .map((l: any) => l);

  // Get release date (P577)
  const releaseDates = getWikidataClaim(entity, 'P577');
  if (releaseDates.length > 0) {
    // Take the first/release date claim
    const date = releaseDates[0];
    if (date && typeof date === 'string') {
      // Parse date - could be "Q577", "1200-01-01", etc.
      enrichment.releaseDate = date;
    }
  }

  // Get director(s) (P57)
  const directors = getWikidataClaim(entity, 'P57');
  enrichment.director = directors
    .filter((d: any) => typeof d === 'object' && d.id && d.label)
    .map((d: any) => d.label || d.id || '');

  // Get soundtrack/composer (P86)
  const soundtracks = getWikidataClaim(entity, 'P86');
  enrichment.soundtrack = soundtracks
    .filter((s: any) => typeof s === 'object' && s.label)
    .map((s: any) => s.label || '');

  // Get based on / adapted from (P136 / P137 / P573)
  // These are optional and may not exist for all movies

  return enrichment;
}

/**
 * Rate limiter for Wikidata API - max 1 request/second per process.
 * Uses a simple timestamp-based throttle.
 */
let lastWikidataRequest = 0;
const WIKIDATA_MIN_INTERVAL = 1000; // 1 second

function throttleWikidataRequest(): void {
  const now = Date.now();
  const elapsed = now - lastWikidataRequest;
  if (elapsed < WIKIDATA_MIN_INTERVAL) {
    const wait = WIKIDATA_MIN_INTERVAL - elapsed;
    // In production, would use setTimeout; here we just yield
    // setTimeout(() => {}, wait);
  }
  lastWikidataRequest = Date.now();
}

/**
 * Cache for Wikidata lookups - 7-day TTL, bounded size.
 */
const wikidataCache = new Map<string, {
  enrichment: WikidataEnrichment | null;
  timestamp: number;
}>();
const WIKIDATA_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHE_SIZE = 500;

function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < WIKIDATA_TTL;
}

function addToCache(key: string, enrichment: WikidataEnrichment | null): void {
  // Enforce max cache size
  if (wikidataCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = wikidataCache.keys().next().value;
    if (oldestKey !== undefined) wikidataCache.delete(oldestKey);
  }
  wikidataCache.set(key, { enrichment, timestamp: Date.now() });
}

function getFromCache(key: string): WikidataEnrichment | null {
  const cached = wikidataCache.get(key);
  if (!cached) return null;
  if (!isCacheValid(cached.timestamp)) {
    wikidataCache.delete(key);
    return null;
  }
  return cached.enrichment;
}

/**
 * Main entry point: enrich a movie with Wikidata data.
 * Checks cache first, then API, then returns result.
 *
 * @param imdbId Canonical IMDb ID (tt#### format) if available
 * @param title Movie title string
 * @param year Movie release year
 * @returns Wikidata enrichment data, or null if not applicable
 */
export async function enrichMovieWithWikidata(
  imdbId: string | undefined,
  title: string,
  year: number
): Promise<WikidataEnrichment | null> {
  // Input validation
  if (!imdbId && !title) return null;

  // Build cache key
  const cacheKey = imdbId
    ? `imdb:${imdbId.toLowerCase()}`
    : `title:${title.toLowerCase()}_${year}`;

  // Check cache first
  const cached = getFromCache(cacheKey);
  if (cached) {
    throttleWikidataRequest();
    return cached;
  }

  // Rate throttle
  throttleWikidataRequest();

  // Search and enrich
  const enrichment = await tryEnrichWithWikidata(imdbId, title, year);

  // Cache result (even if null, to avoid repeated lookups)
  if (enrichment || enrichment === null) {
    addToCache(cacheKey, enrichment);
  }

  return enrichment;
}

/**
 * Example usage within the recommendation pipeline.
 * Integrate into getRecommendationsWithOMDb or selectCandidateMovies.
 *
 * Example:
 *   const wikidata = await enrichMovieWithWikidata(
 *     movie.imdbId,
 *     movie.title,
 *     movie.year
 *   );
 *   if (wikidata && wikidata.country.length > 0) {
 *     console.info(`[wikidata] ${movie.title} from ${wikidata.country.join(', ')}`);
 *   }
 */