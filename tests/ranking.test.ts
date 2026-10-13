import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMovie, selectDiverse, buildReason, RANK_WEIGHTS, RankSignals } from '../server/ranking.js';
import type { MovieItem } from '../server/catalog.js';

function movie(over: Partial<MovieItem> = {}): MovieItem {
  return {
    id: 1, title: 'Test Film', year: 2020, genres: ['Comedy'], runtime: 90,
    rating: 7.5, voteCount: 1000, popularity: 10, overview: '', posterUrl: '',
    language: 'en', isMature: false, isHiddenGem: false, providers: [],
    ...over,
  };
}

const signals: RankSignals = {
  quizGenres: ['Comedy'],
  noteGenres: [],
  moodGenres: ['Comedy', 'Animation'],
  maxMinutes: 120,
  languageSpecific: false,
  preferHiddenGems: false,
  mentionedTitles: [],
};

test('formula: rating base + genre + mood + confidence are additive', () => {
  const s = scoreMovie(movie(), signals);
  const expected =
    RANK_WEIGHTS.ratingBase * 7.5 +
    RANK_WEIGHTS.genrePerMatch * 1 +
    RANK_WEIGHTS.moodAffinity +
    RANK_WEIGHTS.ratingConfidence * (1000 / 5000) +
    RANK_WEIGHTS.runtimeFit; // 90m <= 120 - 15
  assert.ok(Math.abs(s - expected) < 1e-9, `got ${s}, want ${expected}`);
});

test('higher vote count wins rating ties (confidence)', () => {
  const low = scoreMovie(movie({ voteCount: 50 }), signals);
  const high = scoreMovie(movie({ voteCount: 5000 }), signals);
  assert.ok(high > low);
});

test('hidden gem bonus applies only when preferred', () => {
  const gem = movie({ isHiddenGem: true });
  const off = scoreMovie(gem, signals);
  const on = scoreMovie(gem, { ...signals, preferHiddenGems: true });
  assert.equal(on - off, RANK_WEIGHTS.hiddenGemBonus);
});

test('loved-title affinity boosts the mentioned film', () => {
  const base = scoreMovie(movie({ title: 'Past Lives' }), signals);
  const boosted = scoreMovie(movie({ title: 'Past Lives' }), { ...signals, mentionedTitles: ['pastlives'] });
  assert.equal(boosted - base, RANK_WEIGHTS.titleAffinity);
});

test('diversity penalizes near-identical genre sets', () => {
  const a = { movie: movie({ id: 1, genres: ['Animation', 'Family'] }), score: 30 };
  const b = { movie: movie({ id: 2, genres: ['Animation', 'Family', 'Comedy'] }), score: 29 };
  const c = { movie: movie({ id: 3, genres: ['Action', 'Sci-Fi'] }), score: 28 };
  const picked = selectDiverse([a, b, c], 2, false).map((p) => p.movie.id);
  assert.deepEqual(picked, [1, 3]);
});

test('match scores normalize to 90..99 by rank', () => {
  const mk = (id: number, score: number) => ({ movie: movie({ id }), score });
  const out = selectDiverse([mk(1, 30), mk(2, 20), mk(3, 10)], 3, false);
  assert.deepEqual(out.map((o) => o.matchScore), [99, 95, 90]);
});

test('competitive gem still leads (within gap)', () => {
  const mk = (id: number, score: number, gem: boolean) => ({ movie: movie({ id, isHiddenGem: gem }), score });
  const out = selectDiverse([mk(1, 30, false), mk(2, 26, true)], 2, true);
  assert.equal(out[0].movie.id, 2);
});

test('Fix 3: much weaker gem does not outrank a strong match', () => {
  const mk = (id: number, score: number, gem: boolean, genres: string[]) => ({ movie: movie({ id, isHiddenGem: gem, genres }), score });
  // Strong Action double-match (30) vs obscure gem with one match (12): gap 18 > 6.
  const out = selectDiverse(
    [mk(1, 30, false, ['Action', 'Thriller']), mk(2, 12, true, ['Action'])],
    2,
    true
  );
  assert.equal(out[0].movie.id, 1);
});

test('buildReason cites only verified facts', () => {
  const r = buildReason(
    { title: 'X', genres: ['Comedy'], rating: 8.3, runtime: 81, language: 'en', isHiddenGem: true },
    { matchedGenres: ['Comedy'], maxMinutes: 90, maxRuntimeLabel: 'Under 90 min', languageLabel: null, audienceFlavor: 'Solo.' }
  );
  assert.ok(r.includes('Comedy') && r.includes('8.3') && r.includes('1h 21m') && r.includes('gem') && r.includes('Solo.'));
  assert.ok(!r.toLowerCase().includes('oscar') && !r.toLowerCase().includes('spoiler'));
});
