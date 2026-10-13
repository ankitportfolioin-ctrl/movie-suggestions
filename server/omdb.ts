import { FALLBACK_CATALOG, MovieItem } from './catalog.js';
import { parseNote } from './noteParser.js';
import {
  scoreMovie,
  selectDiverse,
  buildReason,
  AUDIENCE_FLAVOR,
  RankSignals,
} from './ranking.js';

export interface MoviePick {
  id: number;
  title: string;
  year: number;
  genres: string[];
  runtime: number;
  rating: number;
  overview: string;
  posterUrl: string;
  providers: { name: string; logoUrl: string; type?: string }[];
  reason: string;
  isHiddenGem: boolean;
  /** Relative fit score (90-99) derived from backend ranking. */
  matchScore: number;
  /** Original/primary language code (ISO 639-1). Used by the final gate. */
  language: string;
  /** OMDb `Rated` certificate as served (may be missing). Used by the final gate. */
  certificate?: string;
  /** OMDb `Type` field when known. Used by the final gate. */
  mediaType?: string;
}

export interface RecommendParams {
  mood: string;
  genres: string[];
  audience: string;
  maxRuntime: string;
  languages: string[];
  preferences: {
    highlyRated?: boolean;
    hiddenGems?: boolean;
    recent?: boolean;
    classics?: boolean;
    mature?: boolean;
  };
  note?: string;
  excludeIds?: number[];
}

export const MOOD_GENRES: Record<string, string[]> = {
  Happy: ['Comedy', 'Adventure', 'Animation'],
  Relaxed: ['Comedy', 'Romance', 'Animation', 'Family'],
  Tired: ['Comedy', 'Animation', 'Family'],
  Stressed: ['Comedy', 'Animation', 'Fantasy'],
  Romantic: ['Romance', 'Drama', 'Comedy'],
  Adventurous: ['Adventure', 'Action', 'Sci-Fi', 'Fantasy'],
  Curious: ['Mystery', 'Documentary', 'Sci-Fi', 'Crime'],
  Sad: ['Drama', 'Family', 'Comedy'],
};

export const LANGUAGE_CODES: Record<string, string> = {
  English: 'en',
  Hindi: 'hi',
  Tamil: 'ta',
  Telugu: 'te',
  Korean: 'ko',
  Japanese: 'ja',
  Spanish: 'es',
  French: 'fr',
};

// In-memory cache for OMDb lookups (1 hour)
interface CachedOMDb {
  data: any;
  expiresAt: number;
}
const omdbCache = new Map<string, CachedOMDb>();

/**
 * Generate fallback template reason
 */
export function generateTemplateReason(movie: { title: string; genres: string[] }, mood: string, audience: string): string {
  const genreStr = movie.genres.slice(0, 2).join(' & ');
  if (audience === 'Family with kids') {
    return `A joyful, wholesome ${genreStr.toLowerCase()} that every age in the house will love tonight.`;
  }
  if (audience === 'Partner') {
    return `An atmospheric, engaging ${genreStr.toLowerCase()} pick crafted for a cozy evening for two.`;
  }
  if (audience === 'Friends') {
    return `A high-energy, entertaining ${genreStr.toLowerCase()} that is great to experience together.`;
  }
  switch (mood) {
    case 'Tired':
      return `Light, breezy, and effortlessly entertaining—ideal to unwind without thinking too hard.`;
    case 'Romantic':
      return `Rich in charm and chemistry, perfect for getting lost in a tender, captivating story.`;
    case 'Adventurous':
      return `An exhilarating journey full of momentum, stunning craft, and unforgettable moments.`;
    case 'Curious':
      return `Clever and engrossing, filled with unexpected twists that will keep you guessing.`;
    case 'Sad':
      return `Deeply comforting and heartwarming, offering a gentle lift just when you need it.`;
    case 'Relaxed':
      return `Calm and deeply satisfying, offering a smooth cinematic escape from the daily rush.`;
    case 'Stressed':
      return `Pure escapism and feel-good fun designed to melt away the day's tension.`;
    default:
      return `An uplifting, vibrant watch guaranteed to match your good vibes tonight.`;
  }
}

/** Runtime cap in minutes for a quiz label (Infinity = no cap). */
export function runtimeCap(label: string): number {
  if (label === 'Under 90 min') return 90;
  if (label === 'Under 2 hours') return 120;
  if (label === 'Under 2.5 hours') return 150;
  return Infinity;
}

export interface SelectionResult {
  items: { movie: MovieItem; score: number; matchScore: number }[];
  /** User-facing notes: applied note signals + any relaxed constraints. */
  notices: string[];
  /** Runtime cap actually enforced after ladder relaxations. */
  usedMaxMinutes: number;
  /** Filter flags actually enforced (quiz OR note-derived). Single source for the final gate. */
  effective: { highlyRated: boolean; recent: boolean; classics: boolean };
}

/** Human label for an effective runtime cap. */
export function capLabel(maxMinutes: number): string {
  if (maxMinutes <= 90) return 'under 90 min';
  if (maxMinutes <= 120) return 'under 2 hours';
  if (maxMinutes <= 150) return 'under 2.5 hours';
  return '';
}

interface FilterConstraints {
  dropExcludes: boolean;
  highlyRated: boolean;
  maxMinutes: number;
  requireQuizGenres: boolean;
}

function applyHardFilters(
  pool: MovieItem[],
  params: RecommendParams,
  noteGenres: string[],
  excludeGenres: string[],
  hatedTitles: string[],
  c: FilterConstraints,
  excludeSet: Set<number>,
  targetLangCodes: string[],
  recent: boolean,
  classics: boolean
): MovieItem[] {
  const isFamily = params.audience === 'Family with kids';
  const effectiveMature = !isFamily && Boolean(params.preferences?.mature);
  const surpriseMe = params.genres.includes('Surprise me') || params.genres.length === 0;
  const moodGenreList = MOOD_GENRES[params.mood] || ['Comedy', 'Adventure'];
  const quizGenres = surpriseMe
    ? moodGenreList
    : params.genres.filter((g) => g !== 'Surprise me');

  return pool.filter((movie) => {
    if (!c.dropExcludes && excludeSet.has(movie.id)) return false;
    // Explicitly disliked titles never return.
    const normTitle = movie.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (hatedTitles.includes(normTitle)) return false;
    // Unknown runtime (0) passes: absence of data is not a violation.
    if (movie.runtime > 0 && movie.runtime > c.maxMinutes) return false;

    // Maturity: NEVER relaxed. Family mode additionally requires
    // kid-safe genres and bans Horror/Crime/Thriller.
    if (isFamily) {
      if (movie.isMature) return false;
      const isKidSafe =
        movie.genres.includes('Family') ||
        movie.genres.includes('Animation') ||
        movie.genres.includes('Comedy') ||
        movie.genres.includes('Adventure');
      const hasBad =
        movie.genres.includes('Horror') ||
        movie.genres.includes('Crime') ||
        movie.genres.includes('Thriller');
      if (!isKidSafe || hasBad) return false;
    } else if (!effectiveMature && movie.isMature) {
      return false;
    }

    // Language: NEVER relaxed.
    if (targetLangCodes.length > 0 && !targetLangCodes.includes(movie.language)) return false;

    // Explicit note exclusions ("no horror"): hard ban.
    if (movie.genres.some((g) => excludeGenres.includes(g))) return false;

    if (c.highlyRated && movie.rating < 7.0) return false;

    const currentYear = 2026;
    if (recent && movie.year < currentYear - 5) return false;
    if (classics && movie.year >= 2000) return false;

    if (c.requireQuizGenres) {
      const accepted = [...quizGenres, ...noteGenres];
      if (!movie.genres.some((g) => accepted.includes(g))) return false;
    } else {
      // Relaxed rung: fall back to mood affinity (never unfiltered).
      if (!movie.genres.some((g) => moodGenreList.includes(g))) return false;
    }
    return true;
  });
}

/**
 * Filter + rank + diversify, with a relaxation ladder that NEVER drops
 * maturity, language, or era constraints. Every relaxation is reported
 * via notices so the UI can show partial-result states honestly.
 */
export function selectCandidateMovies(
  params: RecommendParams,
  extraCandidates: MovieItem[] = []
): SelectionResult {
  const notices: string[] = [];
  const note = parseNote(params.note || '');
  const excludeSet = new Set(params.excludeIds || []);

  // Note signals the user stated explicitly. Notices describe only what
  // was actually applied — never bare parse claims (Fix 1d).
  if (note.excludeGenres.length > 0) {
    notices.push(`Leaving out ${note.excludeGenres.join(', ')} per your note.`);
  }
  if (note.unverifiable.length > 0) {
    notices.push(
      `Heads up: we can't screen for ${note.unverifiable.join(', ')} from our data — judge that part yourself.`
    );
  }

  // Effective preferences: note hints apply only where the quiz is silent.
  const quiz = params.preferences || {};
  const recent = Boolean(quiz.recent) || (!quiz.classics && !quiz.recent && note.eraHint === 'recent');
  const classics = Boolean(quiz.classics) || (!quiz.classics && !quiz.recent && note.eraHint === 'classics');
  if (note.eraHint === 'recent' && !quiz.recent && !quiz.classics) notices.push('Focusing on recent releases per your note.');
  if (note.eraHint === 'classics' && !quiz.recent && !quiz.classics) notices.push('Focusing on classics per your note.');
  const highlyRated = Boolean(quiz.highlyRated) || Boolean(note.wantsHighlyRated);

  let maxMinutes = runtimeCap(params.maxRuntime);
  if (note.runtimeHint === 'short' && maxMinutes > 100) {
    maxMinutes = 100;
    notices.push('Keeping it short per your note (around 100 minutes or less).');
  }

  const surpriseMe = params.genres.includes('Surprise me') || params.genres.length === 0;
  const moodGenreList = MOOD_GENRES[params.mood] || ['Comedy', 'Adventure'];
  const quizGenres = surpriseMe
    ? moodGenreList
    : params.genres.filter((g) => g !== 'Surprise me');

  const targetLangCodes: string[] = [];
  if (params.languages && params.languages.length > 0 && !params.languages.includes('Any')) {
    for (const lang of params.languages) {
      if (LANGUAGE_CODES[lang]) targetLangCodes.push(LANGUAGE_CODES[lang]);
    }
  }
  // Note language hints apply only when the quiz left language open.
  if (targetLangCodes.length === 0 && note.languageHints.length > 0) {
    for (const lang of note.languageHints) {
      if (LANGUAGE_CODES[lang]) targetLangCodes.push(LANGUAGE_CODES[lang]);
    }
    if (targetLangCodes.length > 0) {
      notices.push(`Filtering to ${note.languageHints.join(', ')} films per your note.`);
    }
  }

  // Candidate pool: local catalog first (curated flags win on id clash),
  // then live discovery titles.
  const pool: MovieItem[] = [...FALLBACK_CATALOG];
  const poolIds = new Set(pool.map((m) => m.id));
  for (const m of extraCandidates) {
    if (!poolIds.has(m.id)) {
      pool.push(m);
      poolIds.add(m.id);
    }
  }

  const hatedInPool = pool
    .filter((m) =>
      note.hatedTitles.includes(m.title.toLowerCase().replace(/[^a-z0-9]/g, ''))
    )
    .map((m) => m.title);
  if (hatedInPool.length > 0) {
    notices.push(`Skipping ${hatedInPool.join(', ')} per your note.`);
  }

  const base: FilterConstraints = {
    dropExcludes: false,
    highlyRated,
    maxMinutes,
    requireQuizGenres: true,
  };

  const ladder: { notice: string; relax: (c: FilterConstraints) => void }[] = [
    {
      notice: 'Including a couple of highly-rated titles below 7.0 to fill your three.',
      relax: (c) => {
        c.highlyRated = false;
      },
    },
    {
      notice: 'Widened the runtime a little to find your third pick.',
      relax: (c) => {
        c.maxMinutes = c.maxMinutes === 90 ? 120 : c.maxMinutes === 120 ? 150 : Infinity;
      },
    },
    {
      notice: 'Broadened beyond your selected genres using your mood instead.',
      relax: (c) => {
        c.requireQuizGenres = false;
      },
    },
    {
      notice: "Including titles you've already seen to complete your three.",
      relax: (c) => {
        c.dropExcludes = true;
      },
    },
  ];

  let filtered = applyHardFilters(
    pool, params, note.genres, note.excludeGenres, note.hatedTitles, base,
    excludeSet, targetLangCodes, recent, classics
  );
  const constraints: FilterConstraints = { ...base };
  // Relax only while NOTHING matches: 1–2 genuine matches are returned
  // as-is with a partial notice instead of being diluted with filler.
  for (const rung of ladder) {
    if (filtered.length > 0) break;
    rung.relax(constraints);
    const retry = applyHardFilters(
      pool, params, note.genres, note.excludeGenres, note.hatedTitles, constraints,
      excludeSet, targetLangCodes, recent, classics
    );
    if (retry.length > filtered.length) {
      notices.push(rung.notice);
      filtered = retry;
    }
  }

  if (filtered.length === 0) {
    notices.push('No close matches this time — try widening the runtime or genres.');
    return {
      items: [],
      notices,
      usedMaxMinutes: constraints.maxMinutes,
      effective: { highlyRated: constraints.highlyRated, recent, classics },
    };
  }
  if (filtered.length < 3) {
    notices.push(
      `Only found ${filtered.length} close match${filtered.length === 1 ? '' : 'es'} — loosen a filter for a full three.`
    );
  }

  const signals: RankSignals = {
    quizGenres,
    noteGenres: note.genres,
    moodGenres: moodGenreList,
    maxMinutes: constraints.maxMinutes,
    languageSpecific: targetLangCodes.length > 0,
    preferHiddenGems: Boolean(quiz.hiddenGems),
    mentionedTitles: note.mentionedTitles,
  };

  const scored = filtered.map((movie) => ({ movie, score: scoreMovie(movie, signals) }));
  const items = selectDiverse(
    scored,
    Math.min(3, scored.length),
    filtered.some((m) => m.isHiddenGem),
    [...quizGenres, ...note.genres, ...moodGenreList]
  );
  return {
    items,
    notices,
    usedMaxMinutes: constraints.maxMinutes,
    effective: { highlyRated: constraints.highlyRated, recent, classics },
  };
}

/**
 * Fetch detailed movie data from OMDb. Prefers an exact IMDb-ID lookup
 * (`i=`) when the catalog provides a canonical id; otherwise falls back
 * to the legacy title+year search (`t=`), whose result MUST pass
 * validateEnrichment before use.
 */
async function fetchFromOMDb(
  movie: { imdbId?: string; title: string; year: number },
  apiKey: string
): Promise<any | null> {
  const cacheKey = (movie.imdbId || `${movie.title}_${movie.year}`).toLowerCase();
  const now = Date.now();
  const cached = omdbCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  try {
    const url = movie.imdbId
      ? `https://www.omdbapi.com/?apikey=${apiKey}&i=${encodeURIComponent(movie.imdbId)}&plot=short`
      : `https://www.omdbapi.com/?apikey=${apiKey}&t=${encodeURIComponent(movie.title)}&y=${movie.year}&plot=short`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MovieNightPicker/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.Response === 'True') {
      omdbCache.set(cacheKey, { data, expiresAt: now + 3600 * 1000 });
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize a title for comparison: lowercase, alphanumeric only.
 * ("WALL·E" and "WALL-E" both become "walle".)
 */
function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Guard against OMDb fuzzy-search mismatches (e.g. "(500) Days of Summer"
 * resolving to its making-of documentary). Only accept OMDb data when the
 * returned title clearly matches the catalog film and the year is close.
 */
export function isSameFilm(catalogTitle: string, catalogYear: number, omdbData: any): boolean {
  const omdbTitle = typeof omdbData?.Title === 'string' ? normalizeTitle(omdbData.Title) : '';
  const cat = normalizeTitle(catalogTitle);
  if (!omdbTitle || !cat) return false;
  // Equality covers punctuation/spacing variants ("WALL·E" vs "WALL-E").
  // Substring matches are only trusted when barely longer, so a
  // "Making of ..." documentary can't impersonate the real film.
  const titleOk =
    omdbTitle === cat ||
    ((omdbTitle.includes(cat) || cat.includes(omdbTitle)) &&
      Math.abs(omdbTitle.length - cat.length) <= 3);
  if (!titleOk) return false;
  const parsedYear = parseInt(String(omdbData.Year ?? '').slice(0, 4), 10);
  return isNaN(parsedYear) || Math.abs(parsedYear - catalogYear) <= 1;
}

/**
 * Fix 1: authoritative enrichment validation.
 *
 * The catalog's canonical id/title/year/type are authoritative. OMDb data
 * is merged ONLY when it provably describes the same film:
 *  - catalog imdbId present → returned imdbID MUST match (primary rule);
 *  - otherwise (legacy title path) → isSameFilm title/year check PLUS
 *    short-vs-feature and type guards below.
 * Returns {ok, reason}; callers keep catalog metadata on rejection.
 */
export function validateEnrichment(
  catalog: { imdbId?: string; title: string; year: number; runtime: number; genres: string[] },
  omdbData: any
): { ok: boolean; reason: string } {
  if (!omdbData || omdbData.Response !== 'True') {
    return { ok: false, reason: 'empty-response' };
  }
  const omdbId =
    typeof omdbData.imdbID === 'string' ? omdbData.imdbID.toLowerCase() : '';
  if (catalog.imdbId) {
    if (!omdbId || omdbId !== catalog.imdbId.toLowerCase()) {
      return { ok: false, reason: `imdb-mismatch(expected ${catalog.imdbId}, got ${omdbId || 'none'})` };
    }
    if (omdbData.Type && omdbData.Type !== 'movie') {
      return { ok: false, reason: `unexpected-type(${omdbData.Type})` };
    }
    return { ok: true, reason: 'imdb-verified' };
  }
  // Legacy path: no canonical id — defense in depth.
  if (!isSameFilm(catalog.title, catalog.year, omdbData)) {
    return { ok: false, reason: 'title-year-mismatch' };
  }
  if (omdbData.Type && omdbData.Type !== 'movie') {
    return { ok: false, reason: `unexpected-type(${omdbData.Type})` };
  }
  const omdbGenres =
    typeof omdbData.Genre === 'string'
      ? omdbData.Genre.split(',').map((g: string) => g.trim().toLowerCase())
      : [];
  const catalogGenres = catalog.genres.map((g) => g.toLowerCase());
  const omdbRuntime = parseInt(String(omdbData.Runtime ?? ''), 10);
  if (
    omdbGenres.includes('short') &&
    !catalogGenres.includes('short') &&
    catalog.runtime >= 60 &&
    !isNaN(omdbRuntime) &&
    omdbRuntime > 0 &&
    omdbRuntime <= 40
  ) {
    return { ok: false, reason: 'short-vs-feature' };
  }
  return { ok: true, reason: 'title-verified' };
}

export interface RecommendationResult {
  movies: MoviePick[];
  notices: string[];
  effective: { highlyRated: boolean; recent: boolean; classics: boolean };
}

/**
 * Get recommendations enriched with live OMDb data.
 * extraCandidates (e.g. from TMDB discovery) widen the pool; the local
 * catalog always wins on id clashes. OMDb genres are UNIONED with local
 * genres (never clobbering) and OMDb data is title-guard verified.
 */
export async function getRecommendationsWithOMDb(
  params: RecommendParams,
  omdbApiKey?: string,
  extraCandidates: MovieItem[] = []
): Promise<RecommendationResult> {
  const { items: candidates, notices, usedMaxMinutes, effective } =
    selectCandidateMovies(params, extraCandidates);

  const quizGenres =
    params.genres.includes('Surprise me') || params.genres.length === 0
      ? MOOD_GENRES[params.mood] || []
      : params.genres.filter((g) => g !== 'Surprise me');
  const note = parseNote(params.note || '');
  const acceptedGenres = [...quizGenres, ...note.genres];
  const singleLanguage =
    params.languages.length === 1 && params.languages[0] !== 'Any'
      ? params.languages[0]
      : null;
  const audienceFlavor =
    AUDIENCE_FLAVOR[params.audience] ?? AUDIENCE_FLAVOR['Just me'];

  // If OMDb API key is provided, enrich in parallel
  const enriched = await Promise.all(
    candidates.map(async ({ movie, matchScore }) => {
      let finalTitle = movie.title;
      let finalYear = movie.year;
      let finalRating = movie.rating;
      let finalRuntime = movie.runtime;
      let finalOverview = movie.overview;
      let finalPoster = movie.posterUrl;
      let finalGenres = movie.genres;

      let finalCertificate: string | undefined;
      let finalMediaType: string | undefined;

      if (omdbApiKey) {
        const omdbData = await fetchFromOMDb(movie, omdbApiKey);
        // Fix 1: merge ONLY validated data; otherwise keep catalog metadata
        // and record a server-side diagnostic (never user-facing).
        const check = validateEnrichment(movie, omdbData);
        if (omdbData && check.ok) {
          if (typeof omdbData.Rated === 'string' && omdbData.Rated !== 'N/A') {
            finalCertificate = omdbData.Rated;
          }
          if (omdbData.Title) finalTitle = omdbData.Title;
          if (omdbData.Year) {
            const parsedYear = parseInt(omdbData.Year, 10);
            if (!isNaN(parsedYear)) finalYear = parsedYear;
          }
          if (omdbData.imdbRating && omdbData.imdbRating !== 'N/A') {
            const parsedRating = parseFloat(omdbData.imdbRating);
            if (!isNaN(parsedRating)) finalRating = parsedRating;
          }
          if (omdbData.Runtime && omdbData.Runtime !== 'N/A') {
            const parsedRuntime = parseInt(omdbData.Runtime, 10);
            if (!isNaN(parsedRuntime)) finalRuntime = parsedRuntime;
          }
          if (omdbData.Plot && omdbData.Plot !== 'N/A') {
            finalOverview = omdbData.Plot;
          }
          if (omdbData.Poster && omdbData.Poster !== 'N/A' && omdbData.Poster.startsWith('http')) {
            finalPoster = omdbData.Poster;
          }
          if (omdbData.Genre && omdbData.Genre !== 'N/A') {
            const parsedGenres = omdbData.Genre.split(',').map((g: string) => g.trim());
            // Union, catalog first: live data adds detail, never erases curation.
            const merged = [...movie.genres];
            for (const g of parsedGenres) {
              if (g && !merged.some((m) => m.toLowerCase() === g.toLowerCase())) {
                merged.push(g);
              }
            }
            if (merged.length > 0) finalGenres = merged.slice(0, 4);
          }
          if (typeof omdbData.Type === 'string' && omdbData.Type) {
            finalMediaType = omdbData.Type;
          }
        } else if (omdbData) {
          // Safe diagnostic: wrong-film data rejected, catalog retained.
          console.warn(
            `[enrichment] rejected OMDb data for "${movie.title}" (${movie.year}): ${check.reason}`
          );
        }
      }

      const matchedGenres = finalGenres.filter((g) => acceptedGenres.includes(g));

      return {
        id: movie.id,
        title: finalTitle,
        year: finalYear,
        genres: finalGenres,
        runtime: finalRuntime,
        rating: finalRating,
        overview: finalOverview,
        posterUrl: finalPoster,
        providers: movie.providers,
        reason: buildReason(
          {
            title: finalTitle,
            genres: finalGenres,
            rating: finalRating,
            runtime: finalRuntime,
            language: movie.language,
            isHiddenGem: movie.isHiddenGem,
          },
          {
            matchedGenres,
            maxMinutes: usedMaxMinutes,
            maxRuntimeLabel: capLabel(usedMaxMinutes),
            languageLabel: singleLanguage,
            audienceFlavor,
          }
        ),
        isHiddenGem: movie.isHiddenGem,
        matchScore,
        language: movie.language,
        certificate: finalCertificate,
        mediaType: finalMediaType,
      };
    })
  );

  // Ensure one hidden gem tag is active
  if (!enriched.some((p) => p.isHiddenGem) && enriched.length > 0) {
    enriched[enriched.length - 1].isHiddenGem = true;
  }

  return { movies: enriched, notices, effective };
}
