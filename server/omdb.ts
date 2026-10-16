import { FALLBACK_CATALOG, MovieItem } from './catalog.js';
import { parseNote } from './noteParser.js';
import {
  scoreWithFeatures,
  selectDiverse,
  buildReason,
  qualifiesAsGem,
  RankSignals,
} from './ranking.js';
import type { FitFeature } from './ranking.js';
import { sanitizeTaste, sanitizeEventCount, tasteBonus } from './taste.js';
import { labelMovie } from './labels.js';

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
  /** Relative fit score (90-99) derived from backend ranking. Not a probability. */
  fitScore: number;
  /** Original/primary language code (ISO 639-1). Used by the final gate. */
  language: string;
  /** OMDb `Rated` certificate as served (may be missing). Used by the final gate. */
  certificate?: string;
  /** OMDb `Type` field when known. Used by the final gate. */
  mediaType?: string;
  /** OMDb cast list as served. Used for person-name exclusions. */
  actors: string[];
  /** OMDb director as served. Used for person-name exclusions. */
  director?: string;
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
    // Fine-tune options (Step 2)
    tones?: string[]; // Light & fun, Thoughtful, Intense, Dark, Uplifting (max 2)
    pace?: string; // Slow-burn, Medium, Fast
    intensity?: string; // No violence, Mild, Moderate, Any
    humorStyle?: string; // Slapstick, Witty, Dark comedy, Satirical
  };
  note?: string;
  excludeIds?: number[];
  /** Optional reference movie IMDb IDs (up to 3). Validated at boundary. */
  referenceIds?: string[];
  /** Optional personal taste vector (Step 3). Sanitized at boundary, never fails. */
  taste?: {
    weights?: Record<string, number>;
    eventCount?: number;
  };
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

// Minimal known-title-to-genre mapping for note-driven genre inference.
const NOTE_TITLE_GENRES: Record<string, string[]> = {
  'breaking bad': ['Crime', 'Drama', 'Thriller'],
  'breakingbad': ['Crime', 'Drama', 'Thriller'],
  'the godfather': ['Crime', 'Drama'],
  'thegodfather': ['Crime', 'Drama'],
  'the dark knight': ['Action', 'Crime', 'Drama', 'Thriller'],
  'thedarkknight': ['Action', 'Crime', 'Drama', 'Thriller'],
  'inception': ['Action', 'Sci-Fi', 'Thriller'],
  'interstellar': ['Adventure', 'Drama', 'Sci-Fi'],
  'parasite': ['Comedy', 'Drama', 'Thriller', 'Mystery'],
  'fight club': ['Drama'],
  'fightclub': ['Drama'],
  'forrest gump': ['Drama', 'Romance'],
  'forrestgump': ['Drama', 'Romance'],
  'the matrix': ['Action', 'Sci-Fi'],
  'thematrix': ['Action', 'Sci-Fi'],
  'star wars': ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'],
  'starwars': ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'],
  'lord of the rings': ['Adventure', 'Fantasy', 'Drama'],
  'lordoftherings': ['Adventure', 'Fantasy', 'Drama'],
  'the shawshank redemption': ['Drama'],
  'theshawshankredemption': ['Drama'],
};

function inferGenresFromTitles(titles: string[]): string[] {
  const inferred: string[] = [];
  for (const t of titles) {
    const norm = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matches = Object.entries(NOTE_TITLE_GENRES).find(([known]) =>
      norm.includes(known) || known.includes(norm)
    );
    if (matches) {
      for (const g of matches[1]) {
        if (!inferred.includes(g)) inferred.push(g);
      }
    }
  }
  return inferred;
}

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
  items: { movie: MovieItem; score: number; fitScore: number; features: FitFeature[] }[];
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

/**
 * Fix 2a: fuzzy named-title match (case/year-insensitive). Any film the
 * user names — loved or hated — is never recommended back.
 */
export function titleIsNamed(movieTitle: string, namedTitles: string[]): boolean {
  const norm = movieTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  return namedTitles.some(
    (n) => n.length >= 4 && (n === norm || norm.includes(n) || n.includes(norm))
  );
}

function applyHardFilters(
  pool: MovieItem[],
  params: RecommendParams,
  noteGenres: string[],
  excludeGenres: string[],
  namedTitles: string[],
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

  // Intensity filter mapping (Step 2)
  const intensityOrder = ['No violence', 'Mild', 'Moderate', 'Any'];
  const userIntensity = params.preferences.intensity;
  const userIntensityIdx = userIntensity ? intensityOrder.indexOf(userIntensity) : -1;

  return pool.filter((movie) => {
    if (!c.dropExcludes && excludeSet.has(movie.id)) return false;
    // Named titles (loved or hated) never return.
    if (titleIsNamed(movie.title, namedTitles)) return false;
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

    // Intensity filter (Step 2): exclude movies above chosen intensity level
    // Only applies when user has selected an intensity and we can infer movie intensity
    if (userIntensityIdx >= 0) {
      const movieIntensity = inferIntensity(movie);
      const movieIntensityIdx = intensityOrder.indexOf(movieIntensity);
      if (movieIntensityIdx >= 0 && movieIntensityIdx > userIntensityIdx) {
        return false;
      }
    }

    if (c.highlyRated && movie.rating < 7.0) return false;

    const currentYear = new Date().getFullYear();
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

/** Infer intensity level from genres and certificate (for hard filtering). */
function inferIntensity(movie: MovieItem): string {
  const genreSet = new Set(movie.genres.map((g) => g.toLowerCase()));
  const cert = (movie.certificate || '').toUpperCase();

  // Certificate-based inference (most reliable when available)
  if (cert === '') return 'Any'; // unknown = treat as no restriction
  if (['G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG', 'U'].includes(cert)) return 'No violence';
  if (['PG-13', 'TV-14', '12', '12A'].includes(cert)) return 'Mild';
  if (['R', 'NC-17', 'TV-MA', '15', '18', '18+', 'A', 'X'].includes(cert)) return 'Any';

  // Genre-based inference (fallback when certificate is unknown)
  if (genreSet.has('horror') || genreSet.has('war')) return 'Any';
  if (genreSet.has('action') && (genreSet.has('crime') || genreSet.has('thriller'))) return 'Moderate';
  if (genreSet.has('action') || genreSet.has('thriller') || genreSet.has('crime')) return 'Mild';
  if (genreSet.has('family') || genreSet.has('animation') || genreSet.has('comedy')) return 'No violence';

  return 'Mild'; // default safe fallback
}

/**
 * Filter + rank + diversify, with a relaxation ladder that NEVER drops
 * maturity, language, or era constraints. Every relaxation is reported
 * via notices so the UI can show partial-result states honestly.
 */
export async function selectCandidateMovies(
  params: RecommendParams,
  extraCandidates: MovieItem[] = [],
  referenceOverviews: string[] = []
): Promise<SelectionResult> {
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
  // Where quiz and note conflict, the quiz wins — disclosed below (Fix 2d).
  const quiz = params.preferences || {};
  const recent = Boolean(quiz.recent) || (!quiz.classics && !quiz.recent && note.eraHint === 'recent');
  const classics = Boolean(quiz.classics) || (!quiz.classics && !quiz.recent && note.eraHint === 'classics');
  if (note.eraHint === 'recent' && !quiz.recent && !quiz.classics) notices.push('Focusing on recent releases per your note.');
  if (note.eraHint === 'classics' && !quiz.recent && !quiz.classics) notices.push('Focusing on classics per your note.');
  if (note.eraHint === 'recent' && quiz.classics) {
    notices.push('Your note asked for recent films, but the quiz says classics — kept classics.');
  }
  if (note.eraHint === 'classics' && quiz.recent) {
    notices.push('Your note asked for classics, but the quiz says recent — kept recent.');
  }
  const highlyRated = Boolean(quiz.highlyRated) || Boolean(note.wantsHighlyRated);

  let maxMinutes = runtimeCap(params.maxRuntime);
  if (note.runtimeHint === 'short' && maxMinutes > 100) {
    maxMinutes = 100;
    notices.push('Keeping it short per your note (around 100 minutes or less).');
  }
  if (note.runtimeHint === 'long' && Number.isFinite(maxMinutes)) {
    notices.push(
      `Your note asked for something long; kept your ${params.maxRuntime} limit.`
    );
  }
  if (note.moods.length > 0 && !note.moods.includes(params.mood)) {
    notices.push(
      `Noted a ${note.moods[0].toLowerCase()} vibe in your note; going with your quiz mood (${params.mood}).`
    );
  }

  const surpriseMe = params.genres.includes('Surprise me') || params.genres.length === 0;
  const moodGenreList = MOOD_GENRES[params.mood] || ['Comedy', 'Adventure'];
  const quizGenres = surpriseMe
    ? moodGenreList
    : params.genres.filter((g) => g !== 'Surprise me');
  const namedTitles = [...note.hatedTitles, ...note.lovedTitles];
  const notedGenres = inferGenresFromTitles(namedTitles);
  // Supplement quizGenres with genres inferred from noted liked/hated titles.
  const enrichedGenres = [...new Set([...quizGenres, ...notedGenres])];

  const targetLangCodes: string[] = [];
  const quizLangLabels = (params.languages || []).filter(
    (l) => l !== 'Any' && LANGUAGE_CODES[l]
  );
  for (const lang of quizLangLabels) {
    targetLangCodes.push(LANGUAGE_CODES[lang]);
  }
  // Note language hints apply only when the quiz left language open.
  if (targetLangCodes.length === 0 && note.languageHints.length > 0) {
    for (const lang of note.languageHints) {
      if (LANGUAGE_CODES[lang]) targetLangCodes.push(LANGUAGE_CODES[lang]);
    }
    if (targetLangCodes.length > 0) {
      notices.push(`Filtering to ${note.languageHints.join(', ')} films per your note.`);
    }
  } else if (quizLangLabels.length > 0 && note.languageHints.length > 0) {
    const hintCodes = note.languageHints.map((l) => LANGUAGE_CODES[l]).filter(Boolean);
    if (hintCodes.length > 0 && !hintCodes.some((c) => targetLangCodes.includes(c))) {
      notices.push(
        `Kept your quiz language (${quizLangLabels.join(', ')}) over your note's (${note.languageHints.join(', ')}).`
      );
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

  // Build reference titles for exclusion (never recommend reference movies back)
  const referenceTitles: string[] = [];
  if (params.referenceIds && params.referenceIds.length > 0) {
    for (const refId of params.referenceIds) {
      // Check catalog for title
      const inCatalog = pool.find((m) => m.imdbId === refId);
      if (inCatalog) referenceTitles.push(inCatalog.title);
    }
  }
  const allNamedTitles = [...namedTitles, ...referenceTitles];
  const namedInPool = pool.filter((m) => titleIsNamed(m.title, allNamedTitles)).map((m) => m.title);
  if (namedInPool.length > 0) {
    notices.push(`Skipping ${namedInPool.join(', ')} — you already mentioned ${namedInPool.length === 1 ? 'it' : 'them'}.`);
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
    pool, params, note.genres, note.excludeGenres, allNamedTitles, base,
    excludeSet, targetLangCodes, recent, classics
  );
  const constraints: FilterConstraints = { ...base };
  // Relax only while NOTHING matches: 1–2 genuine matches are returned
  // as-is with a partial notice instead of being diluted with filler.
  for (const rung of ladder) {
    if (filtered.length > 0) break;
    rung.relax(constraints);
    const retry = applyHardFilters(
      pool, params, note.genres, note.excludeGenres, namedTitles, constraints,
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

  // Step 3: sanitize taste at boundary — never fails, never 400s.
  const tasteWeights = sanitizeTaste(params.taste?.weights);
  const eventCount = sanitizeEventCount(params.taste?.eventCount);

  // Compute movie labels for fine-tune matching (Step 2)
  const movieLabels = new Map<number, { tone: string[]; pace: string; intensity: string; humor: string[]; confidence: number }>();
  for (const m of filtered) {
    const labels = labelMovie(m);
    movieLabels.set(m.id, { tone: labels.tone, pace: labels.pace, intensity: labels.intensity, humor: labels.humor, confidence: labels.confidence });
  }

  const signals: RankSignals = {
    quizGenres,
    noteGenres: note.genres,
    moodGenres: moodGenreList,
    mood: params.mood,
    // Fix 3b: theme anchors are the named films' own verified overviews.
    // (The films themselves are excluded from results; their plots guide.)
    themeRefs: [
      ...referenceOverviews,
      ...pool
        .filter((m) => titleIsNamed(m.title, note.lovedTitles))
        .map((m) => m.overview),
    ],
    maxMinutes: constraints.maxMinutes,
    languageSpecific: targetLangCodes.length > 0,
    preferHiddenGems: Boolean(quiz.hiddenGems),
    mentionedTitles: note.mentionedTitles,
    taste: { weights: tasteWeights, eventCount },
    fineTune: {
      tones: params.preferences.tones,
      pace: params.preferences.pace,
      intensity: params.preferences.intensity,
      humorStyle: params.preferences.humorStyle,
    },
    movieLabels,
  };

  // Fix 3c: normalize gem flags — a flag alone never qualifies a film.
  // Copies only; the canonical catalog entries are never mutated.
  const gemChecked = filtered.map((m) => ({
    ...m,
    isHiddenGem: qualifiesAsGem(m),
  }));
  const scored = gemChecked.map((movie) => {
    const breakdown = scoreWithFeatures(movie, signals, {
      languageLabel: params.languages.length === 1 && params.languages[0] !== 'Any'
        ? params.languages[0]
        : undefined,
    });
    return { movie, score: breakdown.score, features: breakdown.features };
  });
  const items = selectDiverse(
    scored,
    Math.min(3, scored.length),
    gemChecked.some((m) => m.isHiddenGem),
    [...quizGenres, ...note.genres, ...moodGenreList],
    1 // Fix 3d: at most one pick per franchise
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
export async function fetchFromOMDb(
  movie: { imdbId: string } | { imdbId?: string; title: string; year: number },
  apiKey: string
): Promise<any | null> {
  const isById = (m: typeof movie): m is { imdbId: string } => !!m.imdbId;
  const cacheKey = isById(movie)
    ? movie.imdbId.toLowerCase()
    : `${movie.title}_${movie.year}`.toLowerCase();
  const now = Date.now();
  const cached = omdbCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  try {
    const url = isById(movie)
      ? `https://www.omdbapi.com/?apikey=${apiKey}&i=${encodeURIComponent(movie.imdbId)}&plot=short`
      : `https://www.omdbapi.com/?apikey=${apiKey}&t=${encodeURIComponent(movie.title)}&y=${movie.year}&plot=short`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MovieNightPicker/1.0' },
      signal: AbortSignal.timeout(3000),
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
 * Normalize a title for comparison: lowercase, alphanumeric only, with
 * diacritics folded ("Amélie" matches "amelie"; "WALL·E" becomes "walle").
 */
export function normalizeTitle(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Fix 2f: strict validation for ID-less (discovery) candidates. There is
 * no canonical record to fall back on, so a weak title match must DROP
 * the candidate, not merge dubious data. Requires: exact normalized
 * title equality, year within ±1 (festival vs wide release is real —
 * e.g. TMDB lists Coherence as 2013, OMDb as 2014), Type exactly
 * 'movie', and a parseable runtime over 40 minutes (shorts rejected).
 */
export function validateDiscoveryCandidate(
  candidate: { title: string; year: number },
  omdbData: any
): { ok: boolean; reason: string } {
  if (!omdbData || omdbData.Response !== 'True') {
    return { ok: false, reason: 'empty-response' };
  }
  const omdbTitle =
    typeof omdbData.Title === 'string' ? normalizeTitle(omdbData.Title) : '';
  const ours = normalizeTitle(candidate.title);
  if (!omdbTitle || omdbTitle !== ours) {
    return { ok: false, reason: 'title-mismatch' };
  }
  const omdbYear = parseInt(String(omdbData.Year ?? '').slice(0, 4), 10);
  if (isNaN(omdbYear) || Math.abs(omdbYear - candidate.year) > 1) {
    return { ok: false, reason: 'year-mismatch' };
  }
  if (omdbData.Type !== 'movie') {
    return { ok: false, reason: `unexpected-type(${omdbData.Type ?? 'missing'})` };
  }
  const omdbRuntime = parseInt(String(omdbData.Runtime ?? ''), 10);
  if (isNaN(omdbRuntime) || omdbRuntime <= 40) {
    return { ok: false, reason: `implausible-runtime(${omdbData.Runtime ?? 'missing'})` };
  }
  return { ok: true, reason: 'discovery-verified' };
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
 * Fix 2b: does a cast/director credit contain an excluded person?
 * Case-insensitive substring on normalized names.
 */
export function personExcluded(
  actors: string[],
  director: string | undefined,
  excludedPeople: string[]
): string | null {
  const credits = [...actors, ...(director ? director.split(',').map((d) => d.trim()) : [])].map(
    (c) => c.toLowerCase()
  );
  for (const person of excludedPeople) {
    const needle = person.toLowerCase();
    if (needle.length >= 4 && credits.some((c) => c.includes(needle))) {
      return person;
    }
  }
  return null;
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
  // Fetch reference movie overviews for theme similarity (if referenceIds provided)
  let referenceOverviews: string[] = [];
  if (omdbApiKey && params.referenceIds && params.referenceIds.length > 0) {
    const referenceResults = await Promise.all(
      params.referenceIds.map((imdbId) => fetchFromOMDb({ imdbId }, omdbApiKey))
    );
    referenceOverviews = referenceResults
      .filter((r): r is any => r && r.Response === 'True' && typeof r.Plot === 'string' && r.Plot !== 'N/A')
      .map((r) => r.Plot);
    if (referenceOverviews.length < params.referenceIds.length) {
      const missingCount = params.referenceIds.length - referenceOverviews.length;
      console.warn(`[reference] Could not load ${missingCount} of ${params.referenceIds.length} reference movie(s)`);
    }
  }

  const { items: candidates, notices, effective } =
    await selectCandidateMovies(params, extraCandidates, referenceOverviews);

  const note = parseNote(params.note || '');

  // If OMDb API key is provided, enrich in parallel.
  // ID-less discovery candidates get the STRICT check (Fix 2f); a failed
  // check drops the candidate instead of merging dubious data.
  const catalogIds = new Set(FALLBACK_CATALOG.map((m) => m.id));
  const enriched = await Promise.all(
    candidates.map(async ({ movie, fitScore, features }) => {
      const isDiscovery = !catalogIds.has(movie.id);
      let finalTitle = movie.title;
      let finalYear = movie.year;
      let finalRating = movie.rating;
      let finalRuntime = movie.runtime;
      let finalOverview = movie.overview;
      let finalPoster = movie.posterUrl;
      let finalGenres = movie.genres;

      let finalCertificate: string | undefined;
      let finalMediaType: string | undefined;
      let finalActors: string[] = [];
      let finalDirector: string | undefined;

      if (omdbApiKey) {
        const omdbData = await fetchFromOMDb(movie, omdbApiKey);
        // Fix 1: merge ONLY validated data; otherwise keep catalog metadata
        // and record a server-side diagnostic (never user-facing).
        // Fix 2f: ID-less discovery candidates face the strict check and
        // are dropped (not merged) on failure.
        const check = isDiscovery
          ? validateDiscoveryCandidate(movie, omdbData)
          : validateEnrichment(movie, omdbData);
        if (isDiscovery && omdbData && !check.ok) {
          // Unverifiable discovery title — drop, don't merge.
          console.warn(
            `[enrichment] dropped unverifiable discovery title "${movie.title}" (${movie.year}): ${check.reason}`
          );
          return null;
        }
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
          if (typeof omdbData.Actors === 'string' && omdbData.Actors !== 'N/A') {
            finalActors = omdbData.Actors.split(',').map((a: string) => a.trim()).filter(Boolean);
          }
          if (typeof omdbData.Director === 'string' && omdbData.Director !== 'N/A') {
            finalDirector = omdbData.Director;
          }
        } else if (omdbData) {
          // Safe diagnostic: wrong-film data rejected, catalog retained.
          console.warn(
            `[enrichment] rejected OMDb data for "${movie.title}" (${movie.year}): ${check.reason}`
          );
        }
      }

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
        reason: buildReason(features),
        isHiddenGem: movie.isHiddenGem,
        fitScore,
        language: movie.language,
        certificate: finalCertificate,
        mediaType: finalMediaType,
        actors: finalActors,
        director: finalDirector,
      };
    })
  );

  // Fix 2b: enforce person exclusions on enriched cast data.
  // Fix 2f: drop nulls from rejected discovery candidates first.
  const verified = enriched.filter((p): p is NonNullable<typeof p> => p !== null);
  if (verified.length < enriched.length) {
    notices.push(
      `Dropped ${enriched.length - verified.length} title${enriched.length - verified.length === 1 ? '' : 's'} we could not verify.`
    );
  }
  const noteSignals = parseNote(params.note || '');
  const droppedPeople: string[] = [];
  let missingCast = false;
  let filtered = verified;
  if (noteSignals.excludedPeople.length > 0) {
    filtered = verified.filter((p) => {
      if (p.actors.length === 0 && !p.director) {
        missingCast = true;
        return true;
      }
      const hit = personExcluded(p.actors, p.director, noteSignals.excludedPeople);
      if (hit) {
        droppedPeople.push(`${p.title} (${hit})`);
        return false;
      }
      return true;
    });
    const droppedNames = [...new Set(droppedPeople.map((d) => d.replace(/^.*\((.*)\)$/, '$1')))];
    if (droppedNames.length > 0) {
      notices.push(`Left out films with ${droppedNames.join(', ')} per your note.`);
    }
    if (missingCast) {
      notices.push('Cast data was missing for some picks — double-check exclusions yourself.');
    }
  }
  if (noteSignals.likedPeople.length > 0) {
    notices.push(
      `Noted ${noteSignals.likedPeople.join(', ')} — we can't rank by cast from our data.`
    );
  }
  if (filtered.length < verified.length && filtered.length < 3 && filtered.length > 0) {
    const partial = `Only found ${filtered.length} close match${filtered.length === 1 ? '' : 'es'} — loosen a filter for a full three.`;
    if (!notices.includes(partial)) notices.push(partial);
  }

  // Ensure one hidden gem tag is active
  if (!filtered.some((p) => p.isHiddenGem) && filtered.length > 0) {
    filtered[filtered.length - 1].isHiddenGem = true;
  }

  return { movies: filtered, notices, effective };
}
