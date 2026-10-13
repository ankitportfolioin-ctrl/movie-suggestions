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
 *   + w.moodUpliftPerGenre  × (# mood-uplift genre matches)              →  0– 8 pts
 *   − w.moodDownerPerGenre  × (# bleak genres vs upbeat mood)            →  0–−6 pts
 *   + w.ratingConfidence    × min(voteCount, 5000) / 5000              →  0– 2 pts
 *   + w.runtimeFit          × (finite cap && runtime ≤ cap − 15 ? 1:0) →  0– 1 pt
 *   + w.languageFit         × (specific language requested ? 1 : 0)    →  0– 1 pt
 *   + w.hiddenGemBonus      × (prefs.hiddenGems && isHiddenGem ? 1:0)  →  0–10 pts
 *   + w.titleAffinity       × (title loved in note ? 1 : 0)            →  0– 6 pts
 *   + w.themeSimilarity     × max cosine(overview, themeRefs)            →  0– 6 pts
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
  /** Quiz mood label for tone scoring (see MOOD_TONE). */
  mood: string;
  /** Overviews of catalog films the user named (theme anchors, Fix 3b). */
  themeRefs: string[];
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
  /** Uplift bonus per mood-matching genre (Fix 3a, makes mood decisive). */
  moodUpliftPerGenre: 2.0,
  /** Penalty per bleak-genre match against an upbeat mood (Fix 3a). */
  moodDownerPerGenre: 2.0,
  ratingConfidence: 2.0,
  runtimeFit: 1.0,
  languageFit: 1.0,
  hiddenGemBonus: 10.0,
  titleAffinity: 6.0,
  /** Theme-overlap weight for named-film similarity (Fix 3b). */
  themeSimilarity: 6.0,
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
  overview: string;
  isHiddenGem: boolean;
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const STOPWORDS = new Set(
  ('the,a,an,and,or,but,with,from,into,onto,that,this,these,those,their,there,they,them,' +
    'he,she,his,her,its,who,whom,whose,which,when,where,while,after,before,over,under,' +
    'between,through,about,against,have,has,had,will,would,can,could,should,been,being,' +
    'more,most,some,such,than,then,also,just,into,out,for,are,was,were,been,does,did,' +
    'own,same,other,each,find,finds,gets,takes,make,take,goes,comes,back,away,ever,never,' +
    'must,shall,might,upon,within,without,along,among,across,behind,beyond,toward,whom'
  ).split(',')
);

function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z]{4,}/g) || []) {
    if (!STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/**
 * Fix 3c: hidden-gem eligibility. A flag alone is not enough — the film
 * must be well-regarded (rating ≥ 7), genuinely underseen (votes capped),
 * and never a blockbuster by title. Mega-vote titles can never be gems
 * even if some source flags them.
 */
export const GEM_MAX_VOTES = 10000;
const BLOCKBUSTER_TITLES = new Set([
  'interstellar', 'parasite', 'toystory', 'inception', 'thedarkknight',
  'avengersendgame', 'titanic', 'avatar', 'dune', 'oppenheimer', 'barbie',
  'spidermannowayhome', 'johnwick', 'rrr', 'joker', 'avengersinfinitywar',
]);

export function qualifiesAsGem(movie: {
  isHiddenGem: boolean;
  rating: number;
  voteCount: number;
  title: string;
}): boolean {
  if (!movie.isHiddenGem) return false;
  if (!(movie.rating >= 7)) return false;
  if ((movie.voteCount || 0) > GEM_MAX_VOTES) return false;
  if (BLOCKBUSTER_TITLES.has(normalizeTitle(movie.title))) return false;
  return true;
}

/**
 * Franchise stem: "Toy Story 2" and "Toy Story" share a stem; unrelated
 * films do not. Used to cap picks per franchise (Fix 3d).
 */
export function franchiseKey(title: string): string {
  return normalizeTitle(title)
    .replace(/(2|3|4|5|ii|iii|iv|part[0-9]|returns|reloaded|revolutions)$/, '');
}

/**
 * Fix 3b: plot/theme similarity. Cosine similarity on binary term vectors
 * (stopwords removed, min length 4) between a candidate overview and each
 * reference overview (films the user named). Returns the best score 0–1.
 * No LLM, no invented content — pure lexical overlap over verified plots.
 */
export function themeSimilarity(candidateOverview: string, referenceOverviews: string[]): number {
  if (!candidateOverview || referenceOverviews.length === 0) return 0;
  const a = terms(candidateOverview);
  if (a.size === 0) return 0;
  let best = 0;
  for (const ref of referenceOverviews) {
    const b = terms(ref || '');
    if (b.size === 0) continue;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared += 1;
    const sim = shared / Math.sqrt(a.size * b.size);
    if (sim > best) best = sim;
  }
  return best;
}

/**
 * Fix 3a: mood → tone affinity. Upbeat moods are lifted by light genres
 * and penalized per bleak-genre match (horror/thriller/crime grit against
 * Happy/Relaxed/Tired); heavy moods carry no penalty (Sad allows heavy
 * drama; Stressed accepts comfort OR catharsis).
 */
export const MOOD_TONE: Record<string, { uplift: string[]; downers: string[] }> = {
  Happy: { uplift: ['Comedy', 'Animation', 'Family', 'Adventure'], downers: ['Horror', 'Thriller', 'Crime'] },
  Relaxed: { uplift: ['Comedy', 'Romance', 'Animation', 'Family'], downers: ['Horror', 'Thriller', 'Crime'] },
  Tired: { uplift: ['Comedy', 'Animation', 'Family'], downers: ['Horror', 'Thriller', 'Crime'] },
  Stressed: { uplift: ['Comedy', 'Animation', 'Fantasy', 'Family'], downers: [] },
  Romantic: { uplift: ['Romance', 'Drama', 'Comedy'], downers: ['Horror'] },
  Adventurous: { uplift: ['Adventure', 'Action', 'Sci-Fi', 'Fantasy'], downers: [] },
  Curious: { uplift: ['Mystery', 'Documentary', 'Sci-Fi', 'Crime'], downers: [] },
  Sad: { uplift: ['Drama', 'Romance', 'Family', 'Comedy'], downers: [] },
};

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

  const tone = MOOD_TONE[signals.mood];
  if (tone) {
    const uplift = movie.genres.filter((g) => tone.uplift.includes(g)).length;
    score += w.moodUpliftPerGenre * uplift;
    const downers = movie.genres.filter((g) => tone.downers.includes(g)).length;
    score -= w.moodDownerPerGenre * downers;
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

  if (signals.themeRefs.length > 0 && movie.overview) {
    score += w.themeSimilarity * themeSimilarity(movie.overview, signals.themeRefs);
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
  protectedGenres: string[] = [],
  franchiseCap = Infinity
): { movie: T; score: number; matchScore: number }[] {
  const w = RANK_WEIGHTS;
  const remaining = [...candidates].sort((a, b) => b.score - a.score);
  const selected: { movie: T; score: number }[] = [];

  const takeIndex = (idx: number) => {
    const [picked] = remaining.splice(idx, 1);
    selected.push(picked);
  };

  const pickBest = () => {
    let bestIdx = -1;
    let bestEffective = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      // Fix 3d: at most `franchiseCap` picks per franchise stem.
      const key = franchiseKey(remaining[i].movie.title);
      const taken = selected.filter((s) => franchiseKey(s.movie.title) === key).length;
      if (taken >= franchiseCap) continue;
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
      takeIndex(bestIdx);
    }
  };

  if (ensureHiddenGem && remaining.length > 0) {
    // Fix 3: gem-first only when the best gem is competitive with the top.
    const topScore = remaining[0].score;
    const gemIdx = remaining.findIndex(
      (c) => c.movie.isHiddenGem && c.score >= topScore - w.gemFirstMaxGap
    );
    if (gemIdx >= 0) {
      takeIndex(gemIdx);
    }
  }

  while (selected.length < count && remaining.length > 0) {
    const before = selected.length;
    pickBest();
    if (selected.length === before) break; // all remaining capped out
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
