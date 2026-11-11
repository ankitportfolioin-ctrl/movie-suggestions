import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHiddenGem, collectionFilters, passesCollection, sortForCollection, GEM, collectionNotice, fitLabelFor } from '../server/collections.js';
import { buildWhereClause } from '../server/dbMovies.js';
import type { DbFilters } from '../server/dbMovies.js';

const NOW = 2026;
const m = (o: Partial<{ rating: number; voteCount: number; popularity: number; year: number }> = {}) =>
  ({ rating: 7.5, voteCount: 1000, popularity: 8, year: 2020, ...o });
const base: DbFilters = {
  types: ['movie'], genres: [], excludeGenres: [], languages: [], runtimeMin: null, runtimeMax: null,
  yearMin: null, yearMax: null, ratingFloor: null, seasonsMax: null, audience: 'Just me',
  matureAllowed: false, excludeIds: [], limit: 100,
};

test('hidden gem: rule boundaries', () => {
  assert.equal(isHiddenGem(m()), true);
  assert.equal(isHiddenGem(m({ rating: GEM.minRating - 0.1 })), false);
  assert.equal(isHiddenGem(m({ voteCount: GEM.minVotes - 1 })), false);
  assert.equal(isHiddenGem(m({ voteCount: GEM.maxVotes + 1 })), false);
  assert.equal(isHiddenGem(m({ popularity: GEM.maxPopularity + 0.1 })), false);
  assert.equal(isHiddenGem({ rating: 8, voteCount: 1000, year: 2020 }), false, 'missing popularity never qualifies');
  assert.equal(isHiddenGem(m({ popularity: 0 })), false);
});

test('best-of-year is the exact year only', () => {
  assert.equal(passesCollection('best-of-year', m({ year: 2026 }), 2026, NOW), true);
  assert.equal(passesCollection('best-of-year', m({ year: 2025 }), 2026, NOW), false);
  const f = collectionFilters('best-of-year', 2026, NOW);
  assert.equal(f.yearMin, 2026); assert.equal(f.yearMax, 2026);
  const { text } = buildWhereClause({ ...base, ...f });
  assert.ok(/year >= \$\d+/.test(text) && /year <= \$\d+/.test(text) && /votes >= \$\d+/.test(text));
});

test('recent = current year, honestly described (no "this week" claim)', () => {
  assert.equal(passesCollection('recent', m({ year: 2026 }), 2026, NOW), true);
  assert.equal(passesCollection('recent', m({ year: 2025 }), 2026, NOW), false);
  assert.ok(!/this week/i.test(collectionNotice('recent', 2026, NOW)));
});

test('popular and recent order by popularity; gems by rating; best-of by weighted rating', () => {
  const a = m({ popularity: 5, rating: 9, voteCount: 12 });
  const b = m({ popularity: 50, rating: 7, voteCount: 40000 });
  assert.equal(sortForCollection('popular', [a, b])[0], b);
  assert.equal(sortForCollection('best-of-year', [a, b])[0], b, 'tiny-vote 9.0 must not beat 40k-vote 7.0 blindly');
  const g1 = m({ rating: 8.4 }), g2 = m({ rating: 7.3 });
  assert.equal(sortForCollection('hidden-gems', [g2, g1])[0], g1);
});

test('hidden-gems filters reach SQL with a popularity ceiling', () => {
  const { text, params } = buildWhereClause({ ...base, ...collectionFilters('hidden-gems', 2026, NOW) });
  assert.ok(text.includes('popularity IS NOT NULL AND popularity <='));
  assert.ok(params.includes(GEM.maxVotes) && params.includes(GEM.maxPopularity));
});

test('fit label is qualitative', () => {
  assert.equal(fitLabelFor(99), 'Strong match');
  assert.equal(fitLabelFor(95), 'Good match');
  assert.equal(fitLabelFor(90), 'Worth a look');
});
