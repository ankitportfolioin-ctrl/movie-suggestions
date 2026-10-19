import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnrichment, validateDiscoveryCandidate, getRecommendationsWithOMDb } from '../server/omdb.js';
import { FALLBACK_CATALOG } from '../server/catalog.js';
import { baseParams } from './params.js';

// Load .env the same way server.ts does, so the key gate reflects the real env;
// the key present in .env was invisible to the npm test command before this.
import 'dotenv/config';

const FALL_2006 = { imdbId: 'tt0460791', title: 'The Fall', year: 2006, runtime: 117, genres: ['Adventure', 'Fantasy', 'Drama'] };
const SHORT_2006 = { Title: 'The Fall', Year: '2006', Runtime: '4 min', Genre: 'Short', Type: 'movie', imdbID: 'tt21437416', Response: 'True' };
const FEATURE_2008 = { Title: 'The Fall', Year: '2008', Runtime: '117 min', Genre: 'Adventure, Drama, Fantasy', Type: 'movie', imdbID: 'tt0460791', Response: 'True' };

test('imdb-verified enrichment passes', () => {
  const r = validateEnrichment(FALL_2006, FEATURE_2008);
  assert.equal(r.ok, true);
});

test('same-title short film is rejected despite matching title/year', () => {
  const r = validateEnrichment(FALL_2006, SHORT_2006);
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('imdb-mismatch'));
});

test('legacy path rejects short-vs-feature without catalog id', () => {
  const noId = { title: 'The Fall', year: 2006, runtime: 117, genres: ['Adventure'] };
  const r = validateEnrichment(noId, SHORT_2006);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'short-vs-feature');
});

test('unexpected non-movie type is rejected', () => {
  const r = validateEnrichment(FALL_2006, { ...FEATURE_2008, Type: 'series' });
  assert.equal(r.ok, false);
});

test('2f: ID-less discovery validation is strict', () => {
  const cand = { title: 'Coherence', year: 2013 };
  const good = { Title: 'Coherence', Year: '2014', Runtime: '89 min', Genre: 'Mystery', Type: 'movie', Response: 'True' };
  assert.equal(validateDiscoveryCandidate(cand, good).ok, true); // ±1 festival tolerance
  assert.equal(validateDiscoveryCandidate(cand, { ...good, Title: 'Coherence: Remixed' }).ok, false); // title must match exactly
  assert.equal(validateDiscoveryCandidate(cand, { ...good, Year: '2018' }).ok, false); // year drift rejected
  assert.equal(validateDiscoveryCandidate(cand, { ...good, Type: 'series' }).ok, false); // non-movie rejected
  assert.equal(validateDiscoveryCandidate(cand, { ...good, Runtime: '4 min' }).ok, false); // shorts rejected
  assert.equal(validateDiscoveryCandidate(cand, { ...good, Runtime: 'N/A' }).ok, false); // unknown runtime rejected
  assert.equal(validateDiscoveryCandidate(cand, { Response: 'False' }).ok, false);
});

test('empty/failed OMDb responses are rejected safely', () => {
  assert.equal(validateEnrichment(FALL_2006, null).ok, false);
  assert.equal(validateEnrichment(FALL_2006, { Response: 'False', Error: 'Not found' }).ok, false);
});

test('every catalog entry carries a canonical imdbId', () => {
  const missing = FALLBACK_CATALOG.filter((m) => !m.imdbId || !/^tt\d+$/.test(m.imdbId));
  assert.deepEqual(missing.map((m) => m.title), []);
});

test('live: The Fall enriches to the 117-min feature, never the short', { skip: !process.env.OMDB_API_KEY?.trim() }, async () => {
  const { movies } = await getRecommendationsWithOMDb(
    baseParams({ mood: 'Adventurous', genres: ['Fantasy'], maxRuntime: 'Any length' }),
    process.env.OMDB_API_KEY!.trim()
  );
  const fall = movies.find((m) => m.title === 'The Fall');
  assert.ok(fall, `The Fall should be recommended, got [${movies.map((m) => m.title)}]`);
  assert.ok(!fall!.genres.includes('Short'), `genres: ${fall!.genres}`);
  assert.ok(fall!.runtime > 60, `runtime: ${fall!.runtime}`);
});
