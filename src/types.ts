export interface Provider {
  name: string;
  logoUrl: string;
  type?: string;
  /** Title-specific provider page (Watchmode web_url), when the source offers one. */
  url?: string;
}

export interface Movie {
  id: number;
  title: string;
  year: number;
  genres: string[];
  runtime: number;
  rating: number;
  overview: string;
  posterUrl: string;
  providers: Provider[];
  reason: string;
  isHiddenGem?: boolean;
  /** Relative fit score (90-99) computed by the backend ranking. Not a probability. */
  fitScore?: number;
  /** Original/primary language code (ISO 639-1). */
  language?: string;
  /** OMDb `Rated` certificate as served. */
  certificate?: string;
  /** Watch-level minimum age from the catalog (TMDB-derived). Source of truth for the card's age label. */
  minAge?: number | null;
  /** "Rating not confirmed" when a NULL minAge survived OMDb backfill. */
  ratingNote?: string;
  /** Provider-reported content type: "movie" or "series". */
  mediaType?: string;
  /** Media kind from the catalog: 'movie' | 'short' | 'series'. */
  type?: string;
  /** Series facts (absent for movies/shorts). runtime mirrors episodeRuntime. */
  seasons?: number;
  episodes?: number;
  episodeRuntime?: number;
  network?: string;
  firstAirYear?: number;
  lastAirYear?: number;
  status?: string;
  webSeries?: boolean;
  /**
   * Which provider the displayed rating came from. Omitted when the rating is
   * a local-catalog value that no provider verified.
   */
  ratingSource?: 'imdb' | 'tmdb';
}

export interface Preferences {
  highlyRated: boolean;
  hiddenGems: boolean;
  recent: boolean;
  classics: boolean;
  mature: boolean;
  // Fine-tune options (Step 2)
  tones?: string[]; // Light & fun, Thoughtful, Intense, Dark, Uplifting (max 2)
  pace?: string; // Slow-burn, Medium, Fast
  intensity?: string; // No violence, Mild, Moderate, Any
  humorStyle?: string; // Slapstick, Witty, Dark comedy, Satirical (only when Comedy selected)
}

export interface WizardState {
  step: number; // 0 = Hero, 1..8 = Questions, 9 = Results
  /** Media kinds: ['movie'] | ['short'] | ['series'] | all three ('Any'). */
  types: string[];
  mood: string;
  genres: string[];
  audience: string;
  maxRuntime: string;
  languages: string[];
  preferences: Preferences;
  note: string;
  referenceMovies?: ReferenceMovie[];
  /** Explicit collection intent for truthful collections */
  collectionIntent?: { 
    type: 'best-of-year' | 'new-this-week' | 'hidden-gems' | 'family-night';
    year?: number;
  };
}

export interface ReferenceMovie {
  imdbId: string;
  title: string;
  year: number;
}
