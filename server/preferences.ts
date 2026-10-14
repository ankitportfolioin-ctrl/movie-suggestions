/**
 * Structured preference representation for natural-language query understanding.
 *
 * This is the validated, canonical form of a user's intent — produced by
 * the query parser (LLM or deterministic) and consumed by retrieval,
 * filtering, and ranking. All fields use controlled values/enums; no
 * free-form model output reaches database queries or API URLs.
 */

export type MediaType = 'movie' | 'tv';

export type MoodLabel =
  | 'tired'
  | 'low_effort'
  | 'easy_watch'
  | 'intense'
  | 'adrenaline'
  | 'edge_of_seat'
  | 'comforting'
  | 'feel_good'
  | 'relaxed'
  | 'happy'
  | 'stressed'
  | 'romantic'
  | 'adventurous'
  | 'curious'
  | 'sad';

export type GenreLabel =
  | 'Action'
  | 'Adventure'
  | 'Animation'
  | 'Comedy'
  | 'Crime'
  | 'Documentary'
  | 'Drama'
  | 'Family'
  | 'Fantasy'
  | 'Horror'
  | 'Mystery'
  | 'Romance'
  | 'Sci-Fi'
  | 'Thriller'
  | 'Western'
  | 'War'
  | 'Music'
  | 'History';

export type LanguageLabel =
  | 'English'
  | 'Hindi'
  | 'Tamil'
  | 'Telugu'
  | 'Korean'
  | 'Japanese'
  | 'Spanish'
  | 'French'
  | 'German'
  | 'Italian'
  | 'Portuguese'
  | 'Chinese'
  | 'Other';

export type RegionLabel = string; // ISO 3166-1 alpha-2

export type EraLabel =
  | 'classic'
  | '80s'
  | '90s'
  | '2000s'
  | '2010s'
  | 'recent'
  | 'new';

export type IntensityLevel = 'none' | 'low' | 'medium' | 'high';

export type WatchEffortLevel = 'low' | 'medium' | 'high';

export interface ResolvedTitle {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number;
  imdbId?: string;
  confidence: 'high' | 'medium' | 'low';
  alternativeMatches?: ResolvedTitle[];
}

/** Title reference before TMDB resolution — just a free-text string. */
export interface TitleRef {
  title: string;
  year?: number | null;
}

/** Title reference after TMDB resolution. */
export type ResolvedTitleRef = ResolvedTitle;

export interface ParsedPreferences {
  mediaType: MediaType;
  mood: MoodLabel[];
  genres: GenreLabel[];
  /** Free-text title strings mentioned by the user (resolved later via TMDB). */
  likedTitles: TitleRef[];
  dislikedTitles: TitleRef[];
  mustInclude: GenreLabel[];
  excludeGenres: GenreLabel[];
  excludeContent: string[]; // unverifiable descriptors like "gore", "jump scares"
  language: LanguageLabel | null;
  region: RegionLabel | null;
  maxRuntimeMinutes: number | null;
  releasePeriod: EraLabel | null;
  intensity: IntensityLevel | null;
  watchEffort: WatchEffortLevel | null;
  clarificationNeeded: boolean;
  clarificationQuestion: string | null;
  originalQuery: string; // for debugging only
  structuredInputs?: {
    mood?: MoodLabel[];
    genres?: GenreLabel[];
    maxRuntimeMinutes?: number;
    language?: LanguageLabel;
    region?: RegionLabel;
    intensity?: IntensityLevel;
    watchEffort?: WatchEffortLevel;
    excludeGenres?: GenreLabel[];
  };
}

// Controlled vocabularies for validation
export const VALID_MOODS: MoodLabel[] = [
  'tired', 'low_effort', 'easy_watch',
  'intense', 'adrenaline', 'edge_of_seat',
  'comforting', 'feel_good',
  'relaxed', 'happy', 'stressed',
  'romantic', 'adventurous', 'curious', 'sad',
];

export const VALID_GENRES: GenreLabel[] = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror',
  'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'Western',
  'War', 'Music', 'History',
];

export const VALID_LANGUAGES: LanguageLabel[] = [
  'English', 'Hindi', 'Tamil', 'Telugu', 'Korean',
  'Japanese', 'Spanish', 'French', 'German', 'Italian',
  'Portuguese', 'Chinese', 'Other',
];

export const VALID_ERAS: EraLabel[] = [
  'classic', '80s', '90s', '2000s', '2010s', 'recent', 'new',
];

export const VALID_INTENSITIES: IntensityLevel[] = ['none', 'low', 'medium', 'high'];
export const VALID_WATCH_EFFORTS: WatchEffortLevel[] = ['low', 'medium', 'high'];

/**
 * Validate and coerce a raw parsed object into a ParsedPreferences.
 * Unknown values are dropped or set to null; never throws.
 */
export function validatePreferences(raw: unknown): ParsedPreferences {
  const defaults: ParsedPreferences = {
    mediaType: 'movie',
    mood: [],
    genres: [],
    likedTitles: [],
    dislikedTitles: [],
    mustInclude: [],
    excludeGenres: [],
    excludeContent: [],
    language: null,
    region: null,
    maxRuntimeMinutes: null,
    releasePeriod: null,
    intensity: null,
    watchEffort: null,
    clarificationNeeded: false,
    clarificationQuestion: null,
    originalQuery: '',
    structuredInputs: undefined,
  };

  if (!raw || typeof raw !== 'object') return defaults;
  const obj = raw as Record<string, unknown>;

  const mediaType = obj.mediaType === 'tv' ? 'tv' : 'movie';

  const mood = Array.isArray(obj.mood)
    ? obj.mood.filter((m): m is MoodLabel => typeof m === 'string' && VALID_MOODS.includes(m as MoodLabel))
    : [];

  const genres = Array.isArray(obj.genres)
    ? obj.genres.filter((g): g is GenreLabel => typeof g === 'string' && VALID_GENRES.includes(g as GenreLabel))
    : [];

  const likedTitles = Array.isArray(obj.likedTitles)
    ? obj.likedTitles
        .filter((t): t is TitleRef => t && typeof t === 'object' && typeof (t as TitleRef).title === 'string' && (t as TitleRef).title.length > 0)
        .map((t) => ({ title: (t as TitleRef).title, year: (t as TitleRef).year ?? null }))
    : [];

  const dislikedTitles = Array.isArray(obj.dislikedTitles)
    ? obj.dislikedTitles
        .filter((t): t is TitleRef => t && typeof t === 'object' && typeof (t as TitleRef).title === 'string' && (t as TitleRef).title.length > 0)
        .map((t) => ({ title: (t as TitleRef).title, year: (t as TitleRef).year ?? null }))
    : [];

  const mustInclude = Array.isArray(obj.mustInclude)
    ? obj.mustInclude.filter((g): g is GenreLabel => typeof g === 'string' && VALID_GENRES.includes(g as GenreLabel))
    : [];

  const excludeGenres = Array.isArray(obj.excludeGenres)
    ? obj.excludeGenres.filter((g): g is GenreLabel => typeof g === 'string' && VALID_GENRES.includes(g as GenreLabel))
    : [];

  const excludeContent = Array.isArray(obj.excludeContent)
    ? obj.excludeContent.filter((s): s is string => typeof s === 'string')
    : [];

  const language = typeof obj.language === 'string' && VALID_LANGUAGES.includes(obj.language as LanguageLabel)
    ? (obj.language as LanguageLabel)
    : null;

  const region = typeof obj.region === 'string' && obj.region.length === 2
    ? obj.region.toUpperCase()
    : null;

  const maxRuntimeMinutes = typeof obj.maxRuntimeMinutes === 'number' && obj.maxRuntimeMinutes > 0
    ? obj.maxRuntimeMinutes
    : null;

  const releasePeriod = typeof obj.releasePeriod === 'string' && VALID_ERAS.includes(obj.releasePeriod as EraLabel)
    ? (obj.releasePeriod as EraLabel)
    : null;

  const intensity = typeof obj.intensity === 'string' && VALID_INTENSITIES.includes(obj.intensity as IntensityLevel)
    ? (obj.intensity as IntensityLevel)
    : null;

  const watchEffort = typeof obj.watchEffort === 'string' && VALID_WATCH_EFFORTS.includes(obj.watchEffort as WatchEffortLevel)
    ? (obj.watchEffort as WatchEffortLevel)
    : null;

  const clarificationNeeded = typeof obj.clarificationNeeded === 'boolean' ? obj.clarificationNeeded : false;
  const clarificationQuestion = typeof obj.clarificationQuestion === 'string' ? obj.clarificationQuestion : null;
  const originalQuery = typeof obj.originalQuery === 'string' ? obj.originalQuery.slice(0, 500) : '';

  const structuredInputs = obj.structuredInputs && typeof obj.structuredInputs === 'object'
    ? obj.structuredInputs as ParsedPreferences['structuredInputs']
    : undefined;

  return {
    mediaType,
    mood,
    genres,
    likedTitles,
    dislikedTitles,
    mustInclude,
    excludeGenres,
    excludeContent,
    language,
    region,
    maxRuntimeMinutes,
    releasePeriod,
    intensity,
    watchEffort,
    clarificationNeeded,
    clarificationQuestion,
    originalQuery,
    structuredInputs,
  };
}

/**
 * Merge structured UI inputs (quiz answers) with parsed NL preferences.
 * Structured inputs take precedence over inferred preferences.
 */
export function mergeWithStructured(
  parsed: ParsedPreferences,
  structured: ParsedPreferences['structuredInputs']
): ParsedPreferences {
  if (!structured) return parsed;

  const merged = { ...parsed };

  if (structured.mood && structured.mood.length > 0) merged.mood = structured.mood;
  if (structured.genres && structured.genres.length > 0) merged.genres = structured.genres;
  if (structured.maxRuntimeMinutes) merged.maxRuntimeMinutes = structured.maxRuntimeMinutes;
  if (structured.language) merged.language = structured.language;
  if (structured.region) merged.region = structured.region;
  if (structured.intensity) merged.intensity = structured.intensity;
  if (structured.watchEffort) merged.watchEffort = structured.watchEffort;
  if (structured.excludeGenres && structured.excludeGenres.length > 0) {
    merged.excludeGenres = [...new Set([...merged.excludeGenres, ...structured.excludeGenres])];
  }

  merged.structuredInputs = structured;
  return merged;
}

/**
 * Map internal mood labels to quiz mood labels for compatibility.
 */
export const MOOD_TO_QUIZ: Record<MoodLabel, string> = {
  tired: 'Tired',
  low_effort: 'Tired',
  easy_watch: 'Relaxed',
  intense: 'Adventurous',
  adrenaline: 'Adventurous',
  edge_of_seat: 'Adventurous',
  comforting: 'Sad',
  feel_good: 'Happy',
  relaxed: 'Relaxed',
  happy: 'Happy',
  stressed: 'Stressed',
  romantic: 'Romantic',
  adventurous: 'Adventurous',
  curious: 'Curious',
  sad: 'Sad',
};

/**
 * Map internal genre labels to quiz genres.
 */
export const GENRE_TO_QUIZ: Record<GenreLabel, string> = {
  Action: 'Action',
  Adventure: 'Adventure',
  Animation: 'Animation',
  Comedy: 'Comedy',
  Crime: 'Crime',
  Documentary: 'Documentary',
  Drama: 'Drama',
  Family: 'Family',
  Fantasy: 'Fantasy',
  Horror: 'Horror',
  Mystery: 'Mystery',
  Romance: 'Romance',
  'Sci-Fi': 'Sci-Fi',
  Thriller: 'Thriller',
  Western: 'Adventure',
  War: 'Action',
  Music: 'Documentary',
  History: 'Documentary',
};

/**
 * Convert ParsedPreferences to the existing RecommendParams format
 * for backward compatibility with the current pipeline.
 */
export interface RecommendParamsCompat {
  mood: string;
  genres: string[];
  audience: string;
  maxRuntime: string;
  languages: string[];
  preferences: {
    highlyRated: boolean;
    hiddenGems: boolean;
    recent: boolean;
    classics: boolean;
    mature: boolean;
    tones?: string[];
    pace?: string;
    intensity?: string;
    humorStyle?: string;
  };
  note: string;
  excludeIds: number[];
  referenceIds: string[];
}

export function preferencesToRecommendParams(
  prefs: ParsedPreferences,
  defaults: Partial<RecommendParamsCompat> = {}
): RecommendParamsCompat {
  const quizMood = prefs.mood[0] ? MOOD_TO_QUIZ[prefs.mood[0]] : 'Relaxed';
  const quizGenres = prefs.genres.length > 0
    ? prefs.genres.map(g => GENRE_TO_QUIZ[g])
    : ['Surprise me'];
  const quizLanguages = prefs.language ? [prefs.language] : ['Any'];

  let maxRuntime = 'Under 2 hours';
  if (prefs.maxRuntimeMinutes) {
    if (prefs.maxRuntimeMinutes <= 90) maxRuntime = 'Under 90 min';
    else if (prefs.maxRuntimeMinutes <= 120) maxRuntime = 'Under 2 hours';
    else if (prefs.maxRuntimeMinutes <= 150) maxRuntime = 'Under 2.5 hours';
    else maxRuntime = 'Any length';
  }

  const noteParts: string[] = [];
  if (prefs.mood.length > 0) noteParts.push(`Mood: ${prefs.mood.join(', ')}`);
  if (prefs.genres.length > 0) noteParts.push(`Genres: ${prefs.genres.join(', ')}`);
  if (prefs.likedTitles.length > 0) noteParts.push(`Liked: ${prefs.likedTitles.map(t => t.title).join(', ')}`);
  if (prefs.dislikedTitles.length > 0) noteParts.push(`Disliked: ${prefs.dislikedTitles.map(t => t.title).join(', ')}`);
  if (prefs.excludeGenres.length > 0) noteParts.push(`Exclude genres: ${prefs.excludeGenres.join(', ')}`);
  if (prefs.excludeContent.length > 0) noteParts.push(`Avoid: ${prefs.excludeContent.join(', ')}`);
  if (prefs.intensity) noteParts.push(`Intensity: ${prefs.intensity}`);
  if (prefs.watchEffort) noteParts.push(`Watch effort: ${prefs.watchEffort}`);
  if (prefs.releasePeriod) noteParts.push(`Era: ${prefs.releasePeriod}`);

  return {
    mood: quizMood,
    genres: quizGenres,
    audience: defaults.audience || 'Just me',
    maxRuntime,
    languages: quizLanguages,
    preferences: {
      highlyRated: false,
      hiddenGems: false,
      recent: prefs.releasePeriod === 'recent' || prefs.releasePeriod === 'new',
      classics: prefs.releasePeriod === 'classic' || prefs.releasePeriod === '80s' || prefs.releasePeriod === '90s',
      mature: false,
      tones: prefs.mood.includes('intense') || prefs.mood.includes('adrenaline') ? ['Intense'] : undefined,
      pace: prefs.watchEffort === 'low' ? 'Slow-burn' : prefs.watchEffort === 'high' ? 'Fast' : undefined,
      intensity: prefs.intensity === 'none' ? 'No violence' : prefs.intensity === 'low' ? 'Mild' : prefs.intensity === 'medium' ? 'Moderate' : prefs.intensity === 'high' ? 'Any' : undefined,
    },
    note: noteParts.join('; '),
    excludeIds: [], // Will be populated after TMDB resolution
    referenceIds: [], // Will be populated after TMDB resolution
    ...defaults,
  };
}