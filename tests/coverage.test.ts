import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageUnmet } from '../scripts/ingest-tmdb.mjs';

const GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror', 'Mystery',
  'Romance', 'Sci-Fi', 'Thriller'];

function good() {
  return {
    total: 3000,
    byLang: { en: 1000, hi: 100, ta: 100, te: 100, ko: 100, ja: 100, es: 100, fr: 100 },
    byGenre: Object.fromEntries(GENRES.map((g) => [g, 150])),
    pre1990: 300, recent: 300, shortEn: 60, shortHi: 60,
  };
}

describe('coverage verdict', () => {
  test('met targets produce no UNMET lines', () => {
    assert.deepEqual(coverageUnmet(good()), []);
  });

  test('undefined or non-numeric values are UNMET, never met', () => {
    const u = coverageUnmet({
      total: undefined, byLang: {}, byGenre: {},
      pre1990: undefined, recent: NaN, shortEn: undefined, shortHi: '60',
    });
    for (const name of ['total', 'pre1990', 'recent', 'shortEn', 'shortHi']) {
      assert.ok(u.some((s) => s.startsWith(name)), name);
    }
    assert.ok(u.length > 0);
  });

  test('shortfalls are reported with real numbers', () => {
    const u = coverageUnmet({ ...good(), total: 4748, shortHi: 12 });
    assert.ok(u.some((s) => s.includes('shortHi 12<60')));
  });
});
