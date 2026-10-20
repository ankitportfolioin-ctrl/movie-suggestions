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
 * FIT SCORE DISPLAY: selectDiverse normalizes the final 1-3 scores to 90-99
 * so the pill reflects honest relative ranking, never an absolute claim.
 * It is not a probability: never render it with a % sign or "match" claim.
 */

import { tasteBonus } from './taste.js';

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
  /** Optional personal taste vector (Step 3). Untrusted, validated at boundary. */
  taste?: {
    weights: Record<string, number>;
    eventCount: number;
  };
  /** Fine-tune options (Step 2) */
  fineTune?: {
    tones?: string[];
    pace?: string;
    intensity?: string;
    humorStyle?: string;
  };
  /** Movie labels for fine-tune matching */
  movieLabels?: Map<number, { tone: string[]; pace: string; intensity: string; humor: string[]; confidence: number }>;
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
  /** Bonus when the wanted genre is the title's FIRST or SECOND tag. */
  primaryGenreBonus: 3.0,
  runtimeFit: 1.0,
  languageFit: 1.0,
  hiddenGemBonus: 10.0,
  titleAffinity: 6.0,
  /** Theme-overlap weight for named-film similarity (Fix 3b). */
  themeSimilarity: 6.0,
  diversityPerSharedGenre: 3.0,
  /** A gem leads only within this many points of the top score. */
  gemFirstMaxGap: 6.0,
  /** Fine-tune weights (Step 2) */
  toneMatch: 3.0, // per matching tone
  paceMatch: 2.0, // exact pace match
  humorMatch: 2.0, // per matching humor style
  intensityFilterPenalty: 5.0, // penalty for movies above chosen intensity (when labeled)
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
  year: number;
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
  // No stated mood: nothing uplifted, nothing penalized.
  Neutral: { uplift: [], downers: [] },
};

/**
 * Bayesianized rating (IMDb-style): a 10.0 with 12 votes must not outrank a
 * solid 8.0 backed by thousands. Low-vote titles are pulled toward the
 * catalog-wide prior mean until they earn confidence.
 */
const BAYES_PRIOR_MEAN = 6.5;
const BAYES_PRIOR_VOTES = 25;
export function bayesianRating(rating: number, votes: number): number {
  const v = Math.max(0, votes || 0);
  return (v * rating + BAYES_PRIOR_VOTES * BAYES_PRIOR_MEAN) / (v + BAYES_PRIOR_VOTES);
}

export interface FitFeature {
  key: string;
  label: string;
  /** Signed contribution under current RANK_WEIGHTS. */
  contribution: number;
  /** Verified fact (e.g. "108 min"). Absent when there is nothing true to cite. */
  evidence?: string;
  status: 'matched' | 'partial' | 'not_matched' | 'unknown';
}

export interface ScoreBreakdown {
  /** Identical to what scoreMovie returns; features explain the same total. */
  score: number;
  features: FitFeature[];
}

/**
 * Score with per-feature contributions. Every additive term of the original
 * formula appears exactly once below with the same weight and condition, so
 * breakdown.score === scoreMovie(...) for all inputs. Evidence strings cite
 * only values actually evaluated here.
 */
export function scoreWithFeatures(
  movie: RankableMovie, signals: RankSignals, opts?: { languageLabel?: string },
): ScoreBreakdown {
  const w = RANK_WEIGHTS;
  const features: FitFeature[] = [];
  let score = 0;

  const effRating = bayesianRating(movie.rating, movie.voteCount);
  const ratingPart = w.ratingBase * effRating;
  score += ratingPart;
  features.push({
    key: 'rating', label: 'Rating', contribution: ratingPart,
    evidence: movie.rating > 0 ? `rated ${movie.rating.toFixed(1)} (${movie.voteCount || 0} votes)` : undefined,
    status: movie.rating > 0 ? 'matched' : 'unknown',
  });

  const quizOverlap = movie.genres.filter((g) => signals.quizGenres.includes(g));
  score += w.genrePerMatch * quizOverlap.length;
  features.push({
    key: 'genre', label: 'Genre', contribution: w.genrePerMatch * quizOverlap.length,
    evidence: quizOverlap.length > 0 ? quizOverlap.slice(0, 3).join(' + ') : undefined,
    status: quizOverlap.length > 0 ? 'matched' : 'not_matched',
  });

  const noteOverlap = movie.genres.filter((g) => signals.noteGenres.includes(g));
  score += w.noteGenrePerMatch * noteOverlap.length;
  features.push({
    key: 'note_genre', label: 'Note genre', contribution: w.noteGenrePerMatch * noteOverlap.length,
    evidence: noteOverlap.length > 0 ? noteOverlap.slice(0, 3).join(' + ') : undefined,
    status: noteOverlap.length > 0 ? 'matched' : 'not_matched',
  });

  // The wanted genre should lead the card — first or second tag — not hide
  // in tag #4. Decisive against vote-confidence noise on category queries.
  const wantedAll = [...new Set([...signals.quizGenres, ...signals.noteGenres])]
    .filter((g) => g !== 'Surprise me');
  const primaryHits = wantedAll.filter((g) => movie.genres.slice(0, 2).includes(g));
  const primaryPart = primaryHits.length > 0 ? w.primaryGenreBonus : 0;
  score += primaryPart;
  if (wantedAll.length > 0) {
    features.push({
      key: 'primary_genre', label: 'Primary genre', contribution: primaryPart,
      evidence: primaryHits.length > 0 ? `${primaryHits.join(' / ')} leads the tags` : undefined,
      status: primaryHits.length > 0 ? 'matched' : 'not_matched',
    });
  }

  const moodOverlap = movie.genres.filter((g) => signals.moodGenres.includes(g));
  const moodPart = moodOverlap.length > 0 ? w.moodAffinity : 0;
  score += moodPart;
  features.push({
    key: 'mood', label: 'Mood', contribution: moodPart,
    evidence: moodOverlap.length > 0 ? moodOverlap.slice(0, 3).join(' + ') : undefined,
    status: moodOverlap.length > 0 ? 'matched' : 'not_matched',
  });

  const tone = MOOD_TONE[signals.mood];
  if (tone) {
    const uplift = movie.genres.filter((g) => tone.uplift.includes(g));
    const downers = movie.genres.filter((g) => tone.downers.includes(g));
    const tonePart = w.moodUpliftPerGenre * uplift.length - w.moodDownerPerGenre * downers.length;
    score += tonePart;
    features.push({
      key: 'mood_tone', label: 'Mood tone', contribution: tonePart,
      evidence: uplift.length > 0 ? `uplifting ${uplift.slice(0, 3).join(' + ')}` : undefined,
      status: uplift.length > 0 ? 'matched' : 'not_matched',
    });
  }

  const votePart = w.ratingConfidence * (Math.min(movie.voteCount || 0, 5000) / 5000);
  score += votePart;
  features.push({
    key: 'votes', label: 'Votes', contribution: votePart,
    evidence: (movie.voteCount || 0) > 0 ? `${movie.voteCount} votes` : undefined,
    status: (movie.voteCount || 0) > 0 ? 'matched' : 'unknown',
  });

  const runtimeOk = Number.isFinite(signals.maxMinutes) && movie.runtime <= signals.maxMinutes - 15;
  if (runtimeOk) score += w.runtimeFit;
  features.push({
    key: 'runtime', label: 'Runtime', contribution: runtimeOk ? w.runtimeFit : 0,
    evidence: movie.runtime > 0
      ? (Number.isFinite(signals.maxMinutes)
        ? (runtimeOk ? `${movie.runtime} min, within your ${signals.maxMinutes}-minute limit` : `${movie.runtime} min`)
        : `${movie.runtime} min`)
      : undefined,
    status: runtimeOk ? 'matched' : (movie.runtime > 0 ? 'not_matched' : 'unknown'),
  });

  if (signals.languageSpecific) score += w.languageFit;
  features.push({
    key: 'language', label: 'Language', contribution: signals.languageSpecific ? w.languageFit : 0,
    evidence: signals.languageSpecific
      ? (opts?.languageLabel ? `${opts.languageLabel}-language original` : `original language ${movie.language}`)
      : undefined,
    status: signals.languageSpecific ? 'matched' : 'not_matched',
  });

  const gemApplied = signals.preferHiddenGems && movie.isHiddenGem;
  if (gemApplied) score += w.hiddenGemBonus;
  features.push({
    key: 'hidden_gem', label: 'Hidden gem', contribution: gemApplied ? w.hiddenGemBonus : 0,
    evidence: gemApplied ? 'a lesser-known gem' : undefined,
    status: gemApplied ? 'matched' : 'not_matched',
  });

  const normTitle = normalizeTitle(movie.title);
  const titleApplied = signals.mentionedTitles.some((t) => t === normTitle);
  if (titleApplied) score += w.titleAffinity;
  features.push({
    key: 'title', label: 'Named title', contribution: titleApplied ? w.titleAffinity : 0,
    evidence: titleApplied ? `you named "${movie.title}"` : undefined,
    status: titleApplied ? 'matched' : 'not_matched',
  });

  if (signals.themeRefs.length > 0 && movie.overview) {
    const sim = themeSimilarity(movie.overview, signals.themeRefs);
    const themePart = w.themeSimilarity * sim;
    score += themePart;
    features.push({
      key: 'theme', label: 'Theme', contribution: themePart,
      evidence: sim > 0 ? 'shares themes with your references' : undefined,
      status: sim > 0 ? 'matched' : 'not_matched',
    });
  }

  // Step 3: personal taste bonus (average of matched weights, capped by confidence)
  if (signals.taste?.weights) {
    const tastePart = tasteBonus(movie, signals.taste.weights, signals.taste.eventCount);
    score += tastePart;
    features.push({
      key: 'taste', label: 'Taste', contribution: tastePart,
      evidence: tastePart > 0 ? 'matches your past picks' : undefined,
      status: tastePart > 0 ? 'matched' : 'not_matched',
    });
  }

  // Step 2: fine-tune ranking bonuses (tone, pace, humor) — intensity is handled as a filter
  if (signals.fineTune && signals.movieLabels) {
    const labels = signals.movieLabels.get(movie.id);
    if (labels) {
      // Tone match bonus (per matching tone)
      if (signals.fineTune.tones && signals.fineTune.tones.length > 0) {
        const toneMatches = labels.tone.filter((t) => signals.fineTune!.tones!.includes(t));
        const tonePart = w.toneMatch * toneMatches.length;
        score += tonePart;
        features.push({
          key: 'ft_tone', label: 'Tone', contribution: tonePart,
          evidence: toneMatches.length > 0 ? `matching ${toneMatches.join(' + ')} tone` : undefined,
          status: toneMatches.length > 0 ? 'matched' : 'not_matched',
        });
      }
      // Pace match bonus
      if (signals.fineTune.pace) {
        const paceApplied = labels.pace === signals.fineTune.pace;
        if (paceApplied) score += w.paceMatch;
        features.push({
          key: 'ft_pace', label: 'Pace', contribution: paceApplied ? w.paceMatch : 0,
          evidence: paceApplied ? 'matching pace' : undefined,
          status: paceApplied ? 'matched' : 'not_matched',
        });
      }
      // Humor match bonus (per matching humor style)
      if (signals.fineTune.humorStyle) {
        const humorApplied = labels.humor.includes(signals.fineTune.humorStyle);
        if (humorApplied) score += w.humorMatch;
        features.push({
          key: 'ft_humor', label: 'Humor', contribution: humorApplied ? w.humorMatch : 0,
          evidence: humorApplied ? 'matching humor' : undefined,
          status: humorApplied ? 'matched' : 'not_matched',
        });
      }
      // Intensity penalty: if movie intensity exceeds user's chosen level, penalize
      // Only applies when movie has a confident label
      if (signals.fineTune.intensity && labels.confidence > 0.5) {
        const userIntensityIdx = ['No violence', 'Mild', 'Moderate', 'Any'].indexOf(signals.fineTune.intensity);
        const movieIntensityIdx = ['No violence', 'Mild', 'Moderate', 'Any'].indexOf(labels.intensity);
        if (userIntensityIdx >= 0 && movieIntensityIdx >= 0 && movieIntensityIdx > userIntensityIdx) {
          // Penalize movies more intense than user wants
          const penalty = w.intensityFilterPenalty * (movieIntensityIdx - userIntensityIdx);
          score -= penalty;
          features.push({
            key: 'ft_intensity', label: 'Intensity', contribution: -penalty, status: 'not_matched',
          });
        }
      }
    }
  }

  return { score, features };
}

export function scoreMovie(movie: RankableMovie, signals: RankSignals): number {
  return scoreWithFeatures(movie, signals).score;
}

/**
 * Greedy diverse selection: highest score first, then penalize genre
 * overlap with already-selected titles. Optionally guarantees one
 * hidden gem when available (flagged, not fabricated).
 */
export function selectDiverse<T extends RankableMovie, C extends { movie: T; score: number }>(
  candidates: C[],
  count: number,
  ensureHiddenGem: boolean,
  protectedGenres: string[] = [],
  franchiseCap = Infinity
): (C & { fitScore: number })[] {
  const w = RANK_WEIGHTS;
  const remaining = [...candidates].sort((a, b) => b.score - a.score);
  const selected: C[] = [];

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
    fitScore:
      max === min ? 96 : 90 + Math.round((9 * (s.score - min)) / (max - min)),
  }));
}

/**
 * Reason assembled ONLY from positively contributing features with verified
 * evidence. No audience, safety, or availability claims: scoring has no such
 * features, so the rationale must not invent them. Neutral fallback when
 * nothing qualifies.
 */
export function buildReason(features: FitFeature[]): string {
  const supported = features
    .filter((f) => f.status === 'matched' && f.contribution > 0 && f.evidence)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);
  if (supported.length === 0) return 'Recommended based on your selected filters.';
  return supported.map((f) => f.evidence as string).join(' · ');
}
