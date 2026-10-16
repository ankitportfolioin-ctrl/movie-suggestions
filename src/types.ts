export interface Provider {
  name: string;
  logoUrl: string;
  type?: string;
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
  step: number; // 0 = Hero, 1..7 = Questions, 8 = Results
  mood: string;
  genres: string[];
  audience: string;
  maxRuntime: string;
  languages: string[];
  preferences: Preferences;
  note: string;
  referenceMovies?: ReferenceMovie[];
}

export interface ReferenceMovie {
  imdbId: string;
  title: string;
  year: number;
}
