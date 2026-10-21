import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendationsWithOMDb } from '../server/omdb.js';
import { discoverCandidates, searchTitles } from '../server/discovery.js';
import { baseParams } from './params.js';

// Load .env the same way server.ts does, so the key gates reflect the real env;
// keys present in .env were invisible to the npm test command before this.
import 'dotenv/config';

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
  // D06: the wanted genre must lead (first or second tag) on every pick —
  // a Comedy hiding in tag #3 (like Toy Story's) no longer makes the cut.
  for (const m of movies) {
    assert.ok(m.genres.slice(0, 2).includes('Comedy'), `${m.title}: ${m.genres}`);
    assert.ok(m.rating > 0 && m.posterUrl.startsWith('http'));
    assert.ok(m.reason.length > 10 && !/guaranteed/i.test(m.reason));
    assert.ok(m.fitScore >= 90 && m.fitScore <= 99);
  }
  assert.ok(Array.isArray(notices));
});

// Live-TMDB tests are explicit opt-in (TMDB_LIVE_TESTS=1): recorded evidence// 2026-10-19 — with the real key from .env, searchTitles timed out at the
// module's internal 3s bound from this network, and discoverCandidates is
// additionally gated by ENABLE_TMDB (default off = local 4,748-title catalog).
// They are blocked here, not failed and not passed.
const TMDB_LIVE = Boolean(TMDB_KEY) && process.env.TMDB_LIVE_TESTS === '1';

test('TMDB title search finds a real film', { skip: !TMDB_LIVE }, async () => {
  const hits = await searchTitles('Dune', 2021, TMDB_KEY!);
  assert.ok(hits && hits.length > 0);
  assert.ok(hits![0].title.toLowerCase().includes('dune'));
  assert.ok(typeof hits![0].id === 'number' && hits![0].posterUrl.includes('image.tmdb.org'));
});

test('TMDB discovery returns deduplicated candidates', { skip: !TMDB_LIVE }, async () => {
  const out = await discoverCandidates(
    { genres: ['Sci-Fi'], languages: ['English'], maxRuntime: 'Any length', highlyRated: true, recent: false, classics: false, family: false, mature: false, excludeIds: [] },
    TMDB_KEY!
  );
  assert.ok(out && out.length > 0);
  const ids = out!.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

// DB-only pipeline (no OMDb/TMDB serving path): anchors resolve locally.
test('DB anchor resolves without any API key and seeds similarity', { skip: !process.env.DATABASE_URL }, async () => {
  const { loadAnchorsByImdb } = await import('../server/dbMovies.js');
  const anchors = await loadAnchorsByImdb(['tt0816692']); // Interstellar
  assert.ok(anchors.length > 0, 'expected Interstellar in the DB');
  assert.ok(/interstell/i.test(anchors[0].title));
  const { movies, notices } = await getRecommendationsWithOMDb(
    baseParams({ mood: 'Adventurous', genres: ['Sci-Fi'], referenceIds: ['tt0816692'] }),
    undefined, [], anchors.map((a) => a.overview).filter(Boolean)
  );
  assert.ok(movies.length > 0);
  assert.ok(notices.some((n) => /similarity reference/i.test(n)), JSON.stringify(notices));
});

test('missing anchors are disclosed honestly (no silent fake similarity)', { skip: !process.env.DATABASE_URL }, async () => {
  const { getRecommendationsWithOMDb } = await import('../server/omdb.js');
  const { movies, notices } = await getRecommendationsWithOMDb(
    baseParams({ mood: 'Happy', genres: ['Comedy'], referenceIds: ['tt99999999'] }),
    undefined, [], []
  );
  assert.ok(movies.length > 0);
  assert.ok(notices.some((n) => /similarity matching|other filters/i.test(n)), JSON.stringify(notices));
});
