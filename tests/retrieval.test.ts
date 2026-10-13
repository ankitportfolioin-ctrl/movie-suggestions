import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendationsWithOMDb } from '../server/omdb.js';
import { discoverCandidates, searchTitles } from '../server/discovery.js';
import { baseParams } from './params.js';

const OMDB_KEY = process.env.OMDB_API_KEY?.trim();
const TMDB_KEY = process.env.TMDB_API_KEY?.trim();

test('discovery without a key returns null (catalog fallback)', async () => {
  const out = await discoverCandidates(
    { genres: ['Comedy'], languages: ['Any'], maxRuntime: 'Any length', highlyRated: false, recent: false, classics: false, family: false, mature: false, excludeIds: [] },
    ''
  );
  assert.equal(out, null);
});

test('title search without a key returns null', async () => {
  assert.equal(await searchTitles('Dune', 2021, ''), null);
});

test('2b live: "Nothing with Tom Cruise" removes his films with disclosure', { skip: !OMDB_KEY }, async () => {
  const { movies, notices } = await getRecommendationsWithOMDb(
    baseParams({
      mood: 'Curious', genres: ['Sci-Fi', 'Mystery'], maxRuntime: 'Under 2.5 hours',
      languages: ['English'], preferences: { highlyRated: true, hiddenGems: true },
      note: 'Nothing with Tom Cruise',
    }),
    OMDB_KEY
  );
  assert.ok(!movies.map((m) => m.title).includes('Edge of Tomorrow'));
  assert.ok(notices.some((n) => n.includes('Tom Cruise')));
});

test('OMDb enriches a real film end to end', { skip: !OMDB_KEY }, async () => {
  const { movies, notices } = await getRecommendationsWithOMDb(
    baseParams({ mood: 'Tired', genres: ['Comedy'], maxRuntime: 'Under 90 min' }),
    OMDB_KEY
  );
  assert.ok(movies.length >= 2);
  const toy = movies.find((m) => m.title === 'Toy Story');
  assert.ok(toy, 'Toy Story should be recommended');
  assert.ok(toy!.rating > 0 && toy!.posterUrl.startsWith('http'));
  assert.ok(toy!.reason.length > 10 && !/guaranteed/i.test(toy!.reason));
  assert.ok(toy!.matchScore >= 90 && toy!.matchScore <= 99);
  assert.ok(Array.isArray(notices));
});

test('TMDB title search finds a real film', { skip: !TMDB_KEY }, async () => {
  const hits = await searchTitles('Dune', 2021, TMDB_KEY!);
  assert.ok(hits && hits.length > 0);
  assert.ok(hits![0].title.toLowerCase().includes('dune'));
  assert.ok(typeof hits![0].id === 'number' && hits![0].posterUrl.includes('image.tmdb.org'));
});

test('TMDB discovery returns deduplicated candidates', { skip: !TMDB_KEY }, async () => {
  const out = await discoverCandidates(
    { genres: ['Sci-Fi'], languages: ['English'], maxRuntime: 'Any length', highlyRated: true, recent: false, classics: false, family: false, mature: false, excludeIds: [] },
    TMDB_KEY!
  );
  assert.ok(out && out.length > 0);
  const ids = out!.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});
