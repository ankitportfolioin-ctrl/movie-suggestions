import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWhereClause, matchesFilters } from '../server/dbMovies.js';
import type { DbFilters } from '../server/dbMovies.js';

function base(): DbFilters {
  return {
    genres: [], excludeGenres: [], languages: [],
    runtimeMin: null, runtimeMax: null, yearMin: null, yearMax: null,
    ratingFloor: null, audience: 'Just me', matureAllowed: false,
    excludeIds: [], limit: 500,
  };
}

describe('SQL WHERE builder', () => {
  test('empty filters produce no WHERE', () => {
    const { text, params } = buildWhereClause({ ...base(), matureAllowed: true });
    assert.equal(text, '');
    assert.deepEqual(params, []);
  });

  test('genre/language/runtime/year/rating/exclude clauses with ordered params', () => {
    const { text, params } = buildWhereClause({
      ...base(), matureAllowed: true, genres: ['Horror'], excludeGenres: ['Comedy'],
      languages: ['en'], runtimeMin: 90, runtimeMax: 150, yearMin: 2000, yearMax: 2020,
      ratingFloor: 7, excludeIds: [1, 2],
    });
    for (const frag of ['genres && $1', 'NOT (genres && $2)', 'originalLanguage = ANY($3)',
      'runtime >= $4', 'runtime <= $5', 'year >= $6', 'year <= $7', 'rating >= $8',
      'NOT (tmdbId = ANY($9))']) {
      assert.ok(text.includes(frag), frag);
    }
    assert.deepEqual(params.slice(0, 9),
      [['Horror'], ['Comedy'], ['en'], 90, 150, 2000, 2020, 7, [1, 2]]);
  });

  test('family maturity clause: <=6 known or Family/Animation unknown without bad genres', () => {
    const { text } = buildWhereClause({ ...base(), audience: 'Family with kids' });
    assert.ok(text.includes('minAge IS NOT NULL AND minAge <= 6'));
    assert.ok(text.includes(`genres && '{Family,Animation}'`));
    assert.ok(text.includes(`NOT (genres && '{Horror,Crime,Thriller,War}')`));
  });

  test('mature-OFF clause: known <16, unknown allowed unless Horror', () => {
    const { text } = buildWhereClause(base());
    assert.ok(text.includes('(minAge IS NULL OR minAge < 16)'));
    assert.ok(text.includes(`NOT (minAge IS NULL AND genres && '{Horror}')`));
  });

  test('mature-ON has no maturity clause', () => {
    const { text } = buildWhereClause({ ...base(), matureAllowed: true });
    assert.ok(!text.includes('minAge'));
  });
});

describe('matchesFilters (fallback mirror)', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    genres: ['Comedy'], language: 'en', runtime: 100, year: 2010, rating: 7.5,
    minAge: null, ...over,
  });

  test('wanted genres need at least one match; excludes ban', () => {
    assert.equal(matchesFilters(item({ genres: ['Comedy'] }), { ...base(), genres: ['Comedy'] }), true);
    assert.equal(matchesFilters(item({ genres: ['Drama'] }), { ...base(), genres: ['Comedy'] }), false);
    assert.equal(matchesFilters(item({ genres: ['Horror', 'Comedy'] }),
      { ...base(), genres: ['Horror'], excludeGenres: ['Comedy'] }), false);
  });

  test('mature-OFF: 16+ out, unknown Horror out, unknown non-Horror in', () => {
    assert.equal(matchesFilters(item({ minAge: 16 }), base()), false);
    assert.equal(matchesFilters(item({ minAge: 12 }), base()), true);
    assert.equal(matchesFilters(item({ genres: ['Horror'] }), base()), false);
    assert.equal(matchesFilters(item({ genres: ['Drama'] }), base()), true);
  });

  test('family: <=6 in, 12+ out, unknown needs Family/Animation without bad genres', () => {
    const fam = { ...base(), audience: 'Family with kids' };
    assert.equal(matchesFilters(item({ minAge: 6 }), fam), true);
    assert.equal(matchesFilters(item({ minAge: 12 }), fam), false);
    assert.equal(matchesFilters(item({ genres: ['Animation'] }), fam), true);
    assert.equal(matchesFilters(item({ genres: ['Comedy'] }), fam), false);
    assert.equal(matchesFilters(item({ genres: ['Family', 'War'] }), fam), false);
  });
});
