/**
 * Configurable relevance ranking for Movie Night Picker / CineMatch.
 *
 * SCORING FORMULA (all weights in RANK_WEIGHTS below):
 *
 *   score =
 *     w.ratingBase          × rating (0–10)                            →  0–20 pts
 *   + w.genrePerMatch       × (# quiz-genre overlaps)                  →  0– 9 pts
 *   + w.noteGenrePerMatch   × (# note-genre overlaps)                  →  0–12 pts
 *   + w.moodAffinity        × (shares ≥1 mood-list genre ? 1 : 0)      →  0– 2 pts
 *   + w.ratingConfidence    × min(voteCount, 5000) / 5000              →  0– 2 pts
 *   + w.runtimeFit          × (finite cap && runtime ≤ cap − 15 ? 1:0) →  0– 1 pt
 *   + w.languageFit         × (specific language requested ? 1 : 0)    →  0– 1 pt
 *   + w.hiddenGemBonus      × (prefs.hiddenGems && isHiddenGem ? 1:0)  →  0–10 pts
 *   + w.titleAffinity       × (title loved in note ? 1 : 0)            →  0– 6 pts
 *
 * DIVERSITY (greedy MMR-lite in selectDiverse):
 *   candidates are picked highest-score-first; each subsequent candidate
 *   loses w.diversityPerSharedGenre points per genre it shares with any
 *   already-selected title — EXCLUDING genres the user explicitly asked
 *   for (protectedGenres: quiz + note + mood genres). Matching the request
 *   is never punished; only incidental similarity is.
 *
 * HIDDEN GEMS (Fix 3): a gem is slotted first ONLY when it is competitive —
 *   within w.gemFirstMaxGap points of the top score. A much weaker obscure
 *   film is never promoted above a much stronger match; it can still enter
 *   later through normal diverse selection. Obscurity is not relevance.
 *
 * MATCH % DISPLAY: selectDiverse normalizes the final 1–3 scores to 90–99
 * so the pill reflects honest relative ranking, never an absolute claim.
 */

export interface RankSignals {
  /** Genre overlap counts and names, split by source. */
  quizGenres: string[];
  noteGenres: string[];
  /** Mood genre list for affinity check (e.g. MOOD_GENRES[mood]). */
  moodGenres: string[];
  /** Max runtime in minutes (Infinity = no cap). */
  maxMinutes: number;
  /** Whether a specific (non-Any) language was requested. */
  languageSpecific: boolean;
  preferHiddenGems: boolean;
  /** Normalized catalog title mentioned in the free-text note. */
  mentionedTitles: string[];
}

export const RANK_WEIGHTS = {
  ratingBase: 2.0,
  genrePerMatch: 3.0,
  noteGenrePerMatch: 4.0,
  moodAffinity: 2.0,
  ratingConfidence: 2.0,
  runtimeFit: 1.0,
  languageFit: 1.0,
  hiddenGemBonus: 10.0,
  titleAffinity: 6.0,
  diversityPerSharedGenre: 3.0,
  /** A gem leads only within this many points of the top score. */
  gemFirstMaxGap: 6.0,
} as const;

export interface RankableMovie {
  id: number;
  title: string;
  genres: string[];
  runtime: number;
  rating: number;
  voteCount: number;
  language: string;
  isHiddenGem: boolean;
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function scoreMovie(movie: RankableMovie, signals: RankSignals): number {
  const w = RANK_WEIGHTS;
  let score = w.ratingBase * movie.rating;

  const quizOverlap = movie.genres.filter((g) => signals.quizGenres.includes(g));
  score += w.genrePerMatch * quizOverlap.length;

  const noteOverlap = movie.genres.filter((g) => signals.noteGenres.includes(g));
  score += w.noteGenrePerMatch * noteOverlap.length;

  if (movie.genres.some((g) => signals.moodGenres.includes(g))) {
    score += w.moodAffinity;
  }

  score += w.ratingConfidence * (Math.min(movie.voteCount || 0, 5000) / 5000);

  if (Number.isFinite(signals.maxMinutes) && movie.runtime <= signals.maxMinutes - 15) {
    score += w.runtimeFit;
  }

  if (signals.languageSpecific) {
    score += w.languageFit;
  }

  if (signals.preferHiddenGems && movie.isHiddenGem) {
    score += w.hiddenGemBonus;
  }

  const normTitle = normalizeTitle(movie.title);
  if (signals.mentionedTitles.some((t) => t === normTitle)) {
    score += w.titleAffinity;
  }

  return score;
}

/**
 * Greedy diverse selection: highest score first, then penalize genre
 * overlap with already-selected titles. Optionally guarantees one
 * hidden gem when available (flagged, not fabricated).
 */
export function selectDiverse<T extends RankableMovie>(
  candidates: { movie: T; score: number }[],
  count: number,
  ensureHiddenGem: boolean,
  protectedGenres: string[] = []
): { movie: T; score: number; matchScore: number }[] {
  const w = RANK_WEIGHTS;
  const remaining = [...candidates].sort((a, b) => b.score - a.score);
  const selected: { movie: T; score: number }[] = [];

  const pickBest = () => {
    let bestIdx = -1;
    let bestEffective = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      let penalty = 0;
      for (const sel of selected) {
        const shared = remaining[i].movie.genres.filter(
          (g) => sel.movie.genres.includes(g) && !protectedGenres.includes(g)
        ).length;
        penalty += w.diversityPerSharedGenre * shared;
      }
      const effective = remaining[i].score - penalty;
      if (effective > bestEffective) {
        bestEffective = effective;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const [picked] = remaining.splice(bestIdx, 1);
      selected.push(picked);
    }
  };

  if (ensureHiddenGem && remaining.length > 0) {
    // Fix 3: gem-first only when the best gem is competitive with the top.
    const topScore = remaining[0].score;
    const gemIdx = remaining.findIndex(
      (c) => c.movie.isHiddenGem && c.score >= topScore - w.gemFirstMaxGap
    );
    if (gemIdx >= 0) {
      const [gem] = remaining.splice(gemIdx, 1);
      selected.push(gem);
    }
  }

  while (selected.length < count && remaining.length > 0) {
    pickBest();
  }

  const scores = selected.map((s) => s.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  return selected.map((s) => ({
    ...s,
    matchScore:
      max === min ? 96 : 90 + Math.round((9 * (s.score - min)) / (max - min)),
  }));
}

/**
 * Factual, citation-style reason built ONLY from verified fields.
 * Never invents plot points, awards, or availability.
 */
export function buildReason(
  movie: {
    title: string;
    genres: string[];
    rating: number;
    runtime: number;
    language: string;
    isHiddenGem: boolean;
  },
  ctx: {
    matchedGenres: string[];
    maxMinutes: number;
    maxRuntimeLabel: string;
    languageLabel: string | null;
    audienceFlavor: string;
  }
): string {
  const facts: string[] = [];
  if (ctx.matchedGenres.length > 0) {
    facts.push(ctx.matchedGenres.slice(0, 2).join(' & '));
  }
  if (movie.rating > 0) {
    facts.push(`rated ${movie.rating.toFixed(1)}`);
  }
  if (movie.runtime > 0) {
    const h = Math.floor(movie.runtime / 60);
    const m = movie.runtime % 60;
    const len = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
    facts.push(
      Number.isFinite(ctx.maxMinutes)
        ? `${len}, fits ${ctx.maxRuntimeLabel.toLowerCase()}`
        : `${len} long`
    );
  }
  if (ctx.languageLabel) {
    facts.push(`${ctx.languageLabel}-language original`);
  }
  if (movie.isHiddenGem) {
    facts.push('a lesser-known gem');
  }
  const head = facts.length > 0 ? facts.join(' • ') : movie.genres.slice(0, 2).join(' & ');
  return `${head}. ${ctx.audienceFlavor}`;
}

export const AUDIENCE_FLAVOR: Record<string, string> = {
  'Family with kids': 'Wholesome enough for every age in the house tonight.',
  Partner: 'Crafted for a cozy evening for two.',
  Friends: 'Built to be experienced together.',
  'Just me': 'A solid solo watch for tonight.',
};
