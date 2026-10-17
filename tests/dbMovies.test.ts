import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWhereClause, matchesFilters, pickEmptyCause } from '../server/dbMovies.js';
import type { DbFilters, EmptyPoolCounts } from '../server/dbMovies.js';

function base(): DbFilters {
  return {
    types: [], genres: [], excludeGenres: [], languages: [],
    runtimeMin: null, runtimeMax: null, yearMin: null, yearMax: null,
    ratingFloor: null, seasonsMax: null, audience: 'Just me', matureAllowed: false,
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

  test('D-02: Sci-Fi filter matches rows stored as "Science Fiction"', () => {
    const { params } = buildWhereClause({ ...base(), genres: ['Sci-Fi'], excludeGenres: ['Sci-Fi'] });
    assert.deepEqual(params.slice(0, 2), [
      ['Sci-Fi', 'Science Fiction'],
      ['Sci-Fi', 'Science Fiction'],
    ]);
  });

  test('type filter rides SQL: movie default, series+miniseries, any', () => {
    const m = buildWhereClause({ ...base(), types: ['movie'] });
    assert.ok(m.text.includes('type = ANY($1)'));
    assert.deepEqual(m.params, [['movie']]);
    const s = buildWhereClause({ ...base(), types: ['series'], seasonsMax: 1 });
    assert.ok(s.text.includes('type = ANY($1)'));
    assert.ok(s.text.includes('seasons <= $2'));
    assert.deepEqual(s.params, [['series'], 1]);
    assert.equal(buildWhereClause(base()).text.includes('type ='), false);
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

  test('D-02: pool rows stored as "Science Fiction" satisfy a Sci-Fi filter', () => {
    assert.equal(matchesFilters(item({ genres: ['Science Fiction'] }),
      { ...base(), genres: ['Sci-Fi'] }), true);
    assert.equal(matchesFilters(item({ genres: ['Sci-Fi'] }),
      { ...base(), genres: ['Sci-Fi'] }), true);
    assert.equal(matchesFilters(item({ genres: ['Science Fiction'] }),
      { ...base(), excludeGenres: ['Sci-Fi'] }), false);
  });

  test('type: default movie matches untyped rows; series/short are excluded', () => {
    assert.equal(matchesFilters(item(), { ...base(), types: ['movie'] }), true);
    assert.equal(matchesFilters(item({ type: 'series' }), { ...base(), types: ['movie'] }), false);
    assert.equal(matchesFilters(item({ type: 'short' }), { ...base(), types: ['movie'] }), false);
    assert.equal(matchesFilters(item({ type: 'series', seasons: 3 }),
      { ...base(), types: ['series'] }), true);
    assert.equal(matchesFilters(item({ type: 'series', seasons: 3 }),
      { ...base(), types: ['series'], seasonsMax: 1 }), false);
    assert.equal(matchesFilters(item({ type: 'series', seasons: 1 }),
      { ...base(), types: ['series'], seasonsMax: 1 }), true);
  });
});

describe('pickEmptyCause', () => {
  const zero: EmptyPoolCounts =
    { genres: 0, languages: 0, runtime: 0, year: 0, rating: 0, maturity: 0 };
  const f = () => ({ ...base(), genres: ['Horror'] });

  test('names the constraint whose removal refills the pool', () => {
    assert.ok(pickEmptyCause({ ...zero, genres: 5 }, f())!.includes('Horror'));
    assert.ok(pickEmptyCause({ ...zero, runtime: 5 }, f())!.includes('length'));
    assert.ok(pickEmptyCause({ ...zero, maturity: 5 }, f())!.includes('maturity'));
  });

  test('null when nothing single-handedly emptied it', () => {
    assert.equal(pickEmptyCause(zero, f()), null);
  });
});
