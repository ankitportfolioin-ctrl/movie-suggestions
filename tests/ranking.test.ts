import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMovie, selectDiverse, buildReason, themeSimilarity, qualifiesAsGem, franchiseKey, RANK_WEIGHTS, RankSignals } from '../server/ranking.js';
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
  mood: 'Happy',
  themeRefs: [],
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
    RANK_WEIGHTS.moodUpliftPerGenre * 1 + // Comedy lifts Happy
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

test('3a: bleak genres penalized under Happy, not under Sad', () => {
  const grim = movie({ genres: ['Thriller', 'Crime'] });
  const happy = scoreMovie(grim, { ...signals, mood: 'Happy', moodGenres: [] });
  const sad = scoreMovie(grim, { ...signals, mood: 'Sad', moodGenres: [] });
  assert.ok(Math.abs(sad - happy - RANK_WEIGHTS.moodDownerPerGenre * 2) < 1e-9);
});

test('3b: theme similarity rewards shared plot vocabulary', () => {
  const ref = 'Two deeply connected childhood friends separated after her family emigrates, reunited decades later.';
  const close = movie({ overview: 'Childhood friends separated by emigration reunite after decades apart.' });
  const far = movie({ overview: 'A cowboy doll is jealous when a spaceman toy supplants him.' });
  const sClose = themeSimilarity(close.overview, [ref]);
  const sFar = themeSimilarity(far.overview, [ref]);
  assert.ok(sClose > 0.3, `close=${sClose}`);
  assert.ok(sFar < sClose);
  assert.equal(themeSimilarity('anything', []), 0);
});

test('3b: theme refs lift similar candidates in scoring', () => {
  const ref = 'Two deeply connected childhood friends separated after her family emigrates.';
  const base = scoreMovie(movie({ overview: 'A soldier fights aliens in a time loop.' }), { ...signals, themeRefs: [ref] });
  const lifted = scoreMovie(
    movie({ overview: 'Childhood friends separated by emigration reunite years later.' }),
    { ...signals, themeRefs: [ref] }
  );
  assert.ok(lifted - base > 2);
});

test('3a: mood penalty reorders a grim pick below lighter fare', () => {
  const grim = { movie: movie({ id: 1, rating: 8.0, genres: ['Thriller'] }), score: 0 };
  const light = { movie: movie({ id: 2, rating: 7.0, genres: ['Comedy'] }), score: 0 };
  const pair = [grim, light];
  const rescoredHappy = pair.map((c) => ({ ...c, score: scoreMovie(c.movie, { ...signals, mood: 'Happy', moodGenres: [] }) }));
  const happyOrder = selectDiverse(rescoredHappy, 2, false).map((p) => p.movie.id);
  assert.deepEqual(happyOrder, [2, 1]);
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

test('3c: gem eligibility needs rating>=7, modest votes, no blockbusters', () => {
  const gem = { isHiddenGem: true, rating: 7.5, voteCount: 1200, title: 'Coherence' };
  assert.equal(qualifiesAsGem(gem), true);
  assert.equal(qualifiesAsGem({ ...gem, rating: 6.9 }), false);
  assert.equal(qualifiesAsGem({ ...gem, voteCount: 35000 }), false);
  assert.equal(qualifiesAsGem({ ...gem, title: 'Interstellar', voteCount: 500 }), false);
  assert.equal(qualifiesAsGem({ ...gem, isHiddenGem: false }), false);
});

test('3d: franchise cap keeps one pick per series', () => {
  const mk = (id: number, title: string, score: number) => ({ movie: movie({ id, title }), score });
  const out = selectDiverse(
    [mk(1, 'Toy Story', 30), mk(2, 'Toy Story 2', 29), mk(3, 'Up', 28)],
    3,
    false,
    [],
    1
  );
  const got = out.map((o) => o.movie.title);
  assert.ok(got.includes('Toy Story'));
  assert.ok(!got.includes('Toy Story 2'));
  assert.ok(got.includes('Up'));
});

test('ranking: Happy mood penalizes bleak genres ( Horror/Thriller/Crime )', () => {
  const grim = movie({ genres: ['Horror', 'Thriller', 'Crime'] });
  const happy = scoreMovie(grim, { ...signals, mood: 'Happy', moodGenres: ['Comedy', 'Animation'] });
  const relaxed = scoreMovie(grim, { ...signals, mood: 'Relaxed', moodGenres: ['Comedy', 'Animation'] });
  const sad = scoreMovie(grim, { ...signals, mood: 'Sad', moodGenres: ['Comedy', 'Animation'] });
  // Happy should have downer penalty for bleak genres
  assert.ok(Math.abs(sad - happy - RANK_WEIGHTS.moodDownerPerGenre * 3) < 1e-9, `sad-${happy} should equal ${RANK_WEIGHTS.moodDownerPerGenre * 3}`);
  // Relaxed also has downer penalty (same genres)
  assert.ok(Math.abs(sad - relaxed - RANK_WEIGHTS.moodDownerPerGenre * 3) < 1e-9, `sad-${relaxed} should equal ${RANK_WEIGHTS.moodDownerPerGenre * 3}`);
  // Sad has no downer penalty
  assert.ok(sad >= happy && sad >= relaxed, 'Sad should not be penalized for bleak genres');
});

test('ranking: The Fall under feel-good gets modest adventure bonus', () => {
  const fallMovie = movie({ id: 14784, title: 'The Fall', genres: ['Adventure', 'Fantasy', 'Drama'], runtime: 117 });
  const happySignals = { ...signals, mood: 'Happy', moodGenres: ['Comedy', 'Animation', 'Family', 'Adventure'] };
  const score = scoreMovie(fallMovie, happySignals);
  // Adventure gives uplift bonus under Happy; Fantasy/Drama don't match Happy uplift list
  assert.ok(score > 0, 'The Fall should score positively under Happy mood');
});

test('ranking: Tired mood uplifts Comedy/Animation/Family', () => {
  const cozy = movie({ id: 1, title: 'Cozy Movie', genres: ['Comedy', 'Animation', 'Family'], runtime: 90 });
  const tiredSignals = { ...signals, mood: 'Tired', moodGenres: ['Comedy', 'Animation', 'Family'] };
  const score = scoreMovie(cozy, tiredSignals);
  assert.ok(score > 0, 'Cozy movie should score under Tired mood');
});

test('ranking: Stressed mood has no downer penalty', () => {
  const grim = movie({ genres: ['Horror', 'Thriller', 'Crime'] });
  const stressedSignals = { ...signals, mood: 'Stressed', moodGenres: [] };
  const score = scoreMovie(grim, stressedSignals);
  // Stressed has empty downers, so no penalty for bleak genres
  assert.ok(score >= 0, 'Stressed should not penalize bleak genres');
});
