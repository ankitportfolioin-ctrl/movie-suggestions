import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWhereClause } from '../server/dbMovies.js';
import type { DbFilters } from '../server/dbMovies.js';

// Production regression: "Any length" produced runtimeMax = Infinity, which
// Postgres rejects as an integer, so every default search silently fell back
// to the built-in demo catalog.

const base: DbFilters = {
  types: ['movie'], genres: [], excludeGenres: [], languages: [], runtimeMin: null, runtimeMax: null,
  yearMin: null, yearMax: null, ratingFloor: null, seasonsMax: null, audience: 'Just me',
  matureAllowed: false, excludeIds: [], limit: 2000,
} as never;

test('an infinite runtime cap adds no SQL clause and no parameter', () => {
  const { text, params } = buildWhereClause({ ...base, runtimeMax: Infinity });
  assert.ok(!/runtime\s*<=/.test(text), text);
  assert.ok(params.every((p) => p !== Infinity && !(typeof p === 'number' && !Number.isFinite(p))));
});

test('a finite runtime cap still becomes a clause', () => {
  const { text, params } = buildWhereClause({ ...base, runtimeMax: 90 });
  assert.ok(/runtime\s*<=\s*\$\d+/.test(text));
  assert.ok(params.includes(90));
});
