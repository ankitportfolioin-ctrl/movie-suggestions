import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendationsWithOMDb } from '../server/omdb.js';
import { enforceHardConstraints } from '../server/gate.js';
import { FALLBACK_CATALOG } from '../server/catalog.js';
import type { MovieItem } from '../server/catalog.js';

// Production regression (live test 2026-10-21, F4/F6): the built-in demo
// catalog was merged into every pool, so a Series search returned demo movies
// that the gate then removed; and picks lost minAge, so every card read
// "Rating not confirmed" and the gate's age rules never ran.

const mk = (i: number, type: 'series' | 'movie'): MovieItem & { minAge: number | null; tmdbId: number; type: string } => ({
  id: 100000 + i, tmdbId: 100000 + i, imdbId: type === 'movie' ? `tt${1000000 + i}` : '',
  title: `${type} number ${i}`, year: 2015 + (i % 9), genres: ['Drama', 'Thriller'], runtime: 45,
  rating: 7 + (i % 20) / 10, voteCount: 5000 + i, popularity: 50 - i / 10, overview: 'A tense story about people.',
  posterUrl: 'https://image.tmdb.org/t/p/w342/x.jpg', language: 'en', isMature: false, isHiddenGem: false,
  providers: [], certificate: 'TV-14', minAge: 12, type,
}) as never;

const params = (types: string[]) => ({
  mood: 'Surprise me', genres: ['Surprise me'], audience: 'Just me', maxRuntime: 'Any length',
  languages: ['Any'], types, preferences: {}, note: '', excludeIds: [], referenceIds: [],
}) as never;

test('a Series search over a database pool returns only series (no demo catalog titles)', async () => {
  const pool = Array.from({ length: 60 }, (_, i) => mk(i, 'series'));
  const r = await getRecommendationsWithOMDb(params(['series']), undefined, pool as never, []);
  const demoIds = new Set(FALLBACK_CATALOG.map((m) => m.id));
  assert.equal(r.movies.length, 10);
  assert.ok(r.movies.every((m) => m.type === 'series'), 'every pick is a series');
  assert.ok(r.movies.every((m) => !demoIds.has(m.id)), 'no demo catalog title leaked in');
});

test('the demo catalog still seeds the pool when the database supplied nothing', async () => {
  const r = await getRecommendationsWithOMDb(params(['movie']), undefined, [], []);
  assert.ok(r.movies.length > 0);
});

test('picks carry minAge and isMature through to the gate', async () => {
  const pool = Array.from({ length: 30 }, (_, i) => mk(i, 'movie'));
  const r = await getRecommendationsWithOMDb(params(['movie']), undefined, pool as never, []);
  assert.ok(r.movies.length > 0);
  for (const m of r.movies) {
    assert.equal(m.minAge, 12);
    assert.equal(m.isMature, false);
  }
});

test('the gate now enforces the family age rule on real picks', async () => {
  const pool = Array.from({ length: 30 }, (_, i) => mk(i, 'movie')); // all minAge 12
  const r = await getRecommendationsWithOMDb(params(['movie']), undefined, pool as never, []);
  const g = enforceHardConstraints(r.movies as never, {
    maxMinutes: Infinity, maxRuntimeLabel: 'Any length', langCodes: [], highlyRated: false,
    recent: false, classics: false, audience: 'Family with kids', matureAllowed: false,
    types: ['movie'], seasonsMax: null,
  } as never);
  assert.equal(g.movies.length, 0, 'minAge 12 is not family-safe, so nothing passes');
});
