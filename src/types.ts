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
  /** Relative fit score (90-99) computed by the backend ranking. */
  matchScore?: number;
}

export interface Preferences {
  highlyRated: boolean;
  hiddenGems: boolean;
  recent: boolean;
  classics: boolean;
  mature: boolean;
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
}
