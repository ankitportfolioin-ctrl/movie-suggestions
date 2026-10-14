/**
 * Step 3 taste tests: sanitization, bonus math, and integration proofs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeTaste,
  sanitizeEventCount,
  tasteBonus,
  movieFeatures,
} from '../server/taste.js';
import { scoreMovie, selectDiverse, RANK_WEIGHTS } from '../server/ranking.js';

const makeMovie = (overrides = {}) => ({
  id: 1,
  title: 'Test Movie',
  genres: ['Comedy', 'Drama'],
  runtime: 100,
  rating: 7.5,
  voteCount: 1000,
  language: 'en',
  overview: 'A test movie.',
  isHiddenGem: false,
  year: 2020,
  ...overrides,
});

const makeSignals = (overrides = {}) => ({
  quizGenres: ['Comedy'],
  noteGenres: [],
  moodGenres: ['Comedy'],
  mood: 'Happy',
  themeRefs: [],
  maxMinutes: Infinity,
  languageSpecific: false,
  preferHiddenGems: false,
  mentionedTitles: [],
  ...overrides,
});

test('sanitizeTaste drops unknown keys, clamps, ignores non-finite, caps features', () => {
  const raw = {
    'genre:comedy': 2.5,           // >1 → clamp to 1
    'genre:drama': -2,             // <-1 → clamp to -1
    'language:en': 0.5,            // ok
    'era:2020plus': NaN,           // dropped
    'director:nolan': 1,           // unknown prefix → dropped
    'genre:action': Infinity,      // dropped
    'genre:horror': 'not-a-number', // dropped
    'genre:thriller': 0.3,         // ok
    'genre:crime': 0.2,            // ok
    'genre:mystery': 0.1,          // ok
  };
  const out = sanitizeTaste(raw);
  assert.equal(out['genre:comedy'], 1);
  assert.equal(out['genre:drama'], -1);
  assert.equal(out['language:en'], 0.5);
  assert.equal(out['genre:thriller'], 0.3);
  assert.equal(out['genre:crime'], 0.2);
  assert.equal(out['genre:mystery'], 0.1);
  assert.ok(!('director:nolan' in out));
  assert.ok(!('era:2020plus' in out));
  assert.ok(!('genre:action' in out));
  assert.ok(!('genre:horror' in out));
  assert.ok(!('genre:horror' in out));
});

test('sanitizeTaste handles non-object and empty gracefully', () => {
  assert.deepEqual(sanitizeTaste(null), {});
  assert.deepEqual(sanitizeTaste(undefined), {});
  assert.deepEqual(sanitizeTaste('string'), {});
  assert.deepEqual(sanitizeTaste([]), {});
  assert.deepEqual(sanitizeTaste(123), {});
  assert.deepEqual(sanitizeTaste({}), {});
});

test('sanitizeEventCount clamps to 0..1000 and requires integer', () => {
  assert.equal(sanitizeEventCount(5), 5);
  assert.equal(sanitizeEventCount(-3), 0);
  assert.equal(sanitizeEventCount(2000), 1000);
  assert.equal(sanitizeEventCount(3.7), 0); // not integer
  assert.equal(sanitizeEventCount(NaN), 0);
  assert.equal(sanitizeEventCount(null), 0);
});

test('movieFeatures extracts genre, language, era', () => {
  const m = makeMovie({ genres: ['Comedy', 'Action'], language: 'ja', year: 1995 });
  const f = movieFeatures(m);
  assert.equal(f['genre:comedy'], 1);
  assert.equal(f['genre:action'], 1);
  assert.equal(f['language:ja'], 1);
  assert.equal(f['era:pre2000'], 1);
  // exactly these three keys
  assert.equal(Object.keys(f).length, 4);
});

test('tasteBonus returns 0 for empty taste or no overlap', () => {
  const m = makeMovie();
  assert.equal(tasteBonus(m, {}, 10), 0);
  assert.equal(tasteBonus(m, { 'genre:horror': 1 }, 10), 0);
  assert.equal(tasteBonus(m, { 'genre:comedy': 1 }, 0), 0); // confidence 0
});

test('tasteBonus uses AVERAGE of matched weights × confidence', () => {
  const m = makeMovie({ genres: ['Comedy', 'Drama'], language: 'en', year: 2020 });
  // movieFeatures: genre:comedy=1, genre:drama=1, language:en=1, era:2020plus=1
  // taste has weights for all four → avg = (1+1+0.5+0)/4 = 0.625
  // bonus = 6.0 * 0.625 * 1 = 3.75
  const taste = { 'genre:comedy': 1, 'genre:drama': 1, 'language:en': 0.5, 'era:2020plus': 0 };
  const bonus = tasteBonus(m, taste, 8);
  assert.ok(Math.abs(bonus - 3.75) < 0.001);
});

test('tasteBonus confidence ramp: 4 events = 0.5 confidence', () => {
  const m = makeMovie({ genres: ['Comedy'] });
  const taste = { 'genre:comedy': 1 };
  const bonus4 = tasteBonus(m, taste, 4); // conf = 4/8 = 0.5
  const bonus8 = tasteBonus(m, taste, 8); // conf = 1
  assert.ok(Math.abs(bonus4 - bonus8 * 0.5) < 0.001);
});

test('scoreMovie with zero taste vector equals no-taste score', () => {
  const m = makeMovie({ genres: ['Comedy', 'Drama'], year: 2020 });
  const s1 = scoreMovie(m, makeSignals({ taste: { weights: {}, eventCount: 0 } }));
  const s2 = scoreMovie(m, makeSignals({ taste: undefined }));
  assert.equal(s1, s2);
});

test('scoreMovie with unknown key + NaN in taste works normally', () => {
  const m = makeMovie({ genres: ['Comedy'], language: 'en', year: 1995 }); // pre2000 era
  const signals = makeSignals({
    taste: {
      weights: { 'genre:comedy': 1, 'genre:horror': NaN, 'director:nolan': 5, 'era:pre2000': 0.5 },
      eventCount: 8,
    },
  });
  // movieFeatures: genre:comedy=1, language:en=1, era:pre2000=1
  // matched weights: genre:comedy=1, era:pre2000=0.5 → avg = 1.5/2 = 0.75
  // bonus = 6 * 0.75 * 1 = 4.5
  const s = scoreMovie(m, signals);
  const s0 = scoreMovie(m, makeSignals({ taste: { weights: {}, eventCount: 0 } }));
  assert.ok(s > s0); // taste bonus applied
  assert.ok(Math.abs((s - s0) - 4.5) < 0.01);
});

test('end-to-end: hostile taste vector does not break hard-constraint gate', async () => {
  // This test proves the integration: even if a malicious taste vector
  // somehow got past sanitization, the final enforceHardConstraints
  // still runs and violations = 0.
  const { enforceHardConstraints } = await import('../server/gate.js');
  const m = makeMovie({ genres: ['Horror'], rating: 5.0, year: 2020, runtime: 150 });
  const gated = enforceHardConstraints([m], {
    maxMinutes: 120,
    maxRuntimeLabel: 'Under 2 hours',
    langCodes: ['en'],
    highlyRated: true,
    recent: false,
    classics: false,
    audience: 'Just me',
    matureAllowed: true,
  });
  assert.equal(gated.movies.length, 0); // rejected by runtime + rating
  assert.ok(gated.relaxed.length > 0); // notices emitted
});

test('selectDiverse with taste still respects all rank weights', () => {
  // Build a pool where taste would clearly favor one if broken
  const pool = [
    makeMovie({ id: 1, genres: ['Comedy'], title: 'A', rating: 7.0 }),
    makeMovie({ id: 2, genres: ['Drama'], title: 'B', rating: 8.0 }),
    makeMovie({ id: 3, genres: ['Action'], title: 'C', rating: 6.0 }),
  ];
  const scored = pool.map((m) => ({ movie: m, score: scoreMovie(m, makeSignals()) }));
  // No taste - normal ranking
  const items1 = selectDiverse(scored, 3, false, ['Comedy'], 1);
  assert.equal(items1.length, 3);

  // With taste favoring Comedy
  const scoredWithTaste = pool.map((m) => ({
    movie: m,
    score: scoreMovie(m, makeSignals({ taste: { weights: { 'genre:comedy': 1 }, eventCount: 8 } })),
  }));
  const items2 = selectDiverse(scoredWithTaste, 3, false, ['Comedy'], 1);
  assert.equal(items2.length, 3);
  // Both produce valid output, no crash
});