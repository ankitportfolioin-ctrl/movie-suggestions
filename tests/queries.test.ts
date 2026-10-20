/**
 * 30 representative user queries with manually judged expectations.
 *
 * Ground truth: the local catalog (network-free). Each case asserts
 * hard-constraint compliance on EVERY result plus judged inclusions /
 * exclusions. These encode product intent — e.g. a tired solo viewer
 * must get short comedies, never horror.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidateMovies, RecommendParams } from '../server/omdb.js';
import { baseParams, titles } from './params.js';

interface Query {
  name: string;
  params: RecommendParams;
  expectCount?: number;
  expectMinCount?: number;
  mustInclude?: string[];
  mustExclude?: string[];
  every?: (m: { title: string; genres: string[]; runtime: number; rating: number; language: string; year: number }) => void;
  noticesMin?: number;
}

const QUERIES: Query[] = [
  { name: 'tired solo short comedy', params: baseParams({ mood: 'Tired', genres: ['Comedy'], maxRuntime: 'Under 90 min' }), expectCount: 3, mustInclude: ['Office Space', 'Fantastic Mr. Fox'], every: (m) => assert.ok(m.genres.slice(0, 2).includes('Comedy'), `${m.title}: ${m.genres}`), mustExclude: ['What We Do in the Shadows'] },
  { name: 'romantic date night', params: baseParams({ mood: 'Romantic', genres: ['Romance'], audience: 'Partner', maxRuntime: 'Under 2 hours' }), expectMinCount: 2, mustInclude: ['Before Sunrise', 'Past Lives'], every: (m) => assert.ok(m.genres.includes('Romance')) },
  { name: 'family animation night', params: baseParams({ mood: 'Happy', genres: ['Animation'], audience: 'Family with kids', maxRuntime: 'Under 2 hours' }), expectCount: 3, mustInclude: ['My Neighbor Totoro'], mustExclude: ['What We Do in the Shadows', 'Memories of Murder'], every: (m) => { assert.ok(m.genres.includes('Animation')); assert.ok(!m.genres.some((g) => ['Horror', 'Crime', 'Thriller'].includes(g))); } },
  { name: 'friends action sci-fi', params: baseParams({ mood: 'Adventurous', genres: ['Action', 'Sci-Fi'], audience: 'Friends', maxRuntime: 'Any length', languages: ['English'] }), expectMinCount: 2, mustInclude: ['Edge of Tomorrow', 'Interstellar'] },
  { name: 'korean mystery night', params: baseParams({ mood: 'Curious', genres: ['Mystery'], maxRuntime: 'Any length', languages: ['Korean'] }), expectCount: 3, mustInclude: ['Parasite', 'Decision to Leave', 'The Call'], mustExclude: ['Memories of Murder'], every: (m) => assert.equal(m.language, 'ko') },
  { name: 'sad drama comfort', params: baseParams({ mood: 'Sad', genres: ['Drama'] }), expectMinCount: 2, every: (m) => assert.ok(m.genres.includes('Drama')) },
  { name: 'stressed comedy relief', params: baseParams({ mood: 'Stressed', genres: ['Comedy'] }), expectMinCount: 2, every: (m) => assert.ok(m.genres.includes('Comedy')) },
  { name: 'relaxed surprise me', params: baseParams({ mood: 'Relaxed', genres: ['Surprise me'] }), expectMinCount: 1, every: (m) => assert.ok(m.genres.some((g) => ['Comedy', 'Romance', 'Animation', 'Family'].includes(g))) },
  { name: 'friends horror opt-in', params: baseParams({ mood: 'Curious', genres: ['Horror'], audience: 'Friends', preferences: { mature: true } }), expectCount: 2, mustInclude: ['What We Do in the Shadows'], noticesMin: 1 },
  { name: 'family asks horror (guardrail)', params: baseParams({ mood: 'Happy', genres: ['Horror'], audience: 'Family with kids' }), expectCount: 3, mustExclude: ['What We Do in the Shadows', 'Memories of Murder', 'The Call'], every: (m) => assert.ok(!m.genres.some((g) => ['Horror', 'Crime', 'Thriller'].includes(g))) },
  { name: 'impossible korean short acclaimed', params: baseParams({ mood: 'Curious', genres: ['Mystery'], languages: ['Korean'], maxRuntime: 'Under 90 min', preferences: { highlyRated: true } }), mustInclude: ['The Call'], mustExclude: ['What We Do in the Shadows', 'Memories of Murder'], noticesMin: 1 },
  { name: 'tamil cinema', params: baseParams({ genres: ['Action'], languages: ['Tamil'] }), mustInclude: ['Kaithi'] },
  { name: 'hindi classic (none exist)', params: baseParams({ languages: ['Hindi'], preferences: { classics: true } }), expectCount: 0, noticesMin: 1 },
  { name: 'recent epic adventure', params: baseParams({ mood: 'Adventurous', preferences: { recent: true } }), mustInclude: ['RRR'] },
  { name: 'pre-2000 adventure', params: baseParams({ genres: ['Adventure'], preferences: { classics: true } }), mustInclude: ['The Good, the Bad and the Ugly', 'Toy Story'], every: (m) => assert.ok(m.year < 2000) },
  { name: 'highly rated drama only', params: baseParams({ genres: ['Drama'], preferences: { highlyRated: true } }), expectMinCount: 2, every: (m) => assert.ok(m.rating >= 7) },
  { name: 'note: no scary stuff', params: baseParams({ genres: ['Comedy'], note: 'no scary stuff please' }), expectMinCount: 2, mustExclude: ['What We Do in the Shadows'], noticesMin: 1 },
  { name: 'note: something short', params: baseParams({ maxRuntime: 'Any length', note: 'something short and quick' }), expectMinCount: 2, every: (m) => assert.ok(m.runtime <= 100) },
  { name: 'note: loved Past Lives (never recommended back)', params: baseParams({ mood: 'Romantic', genres: ['Romance'], audience: 'Partner', note: 'Loved Past Lives' }), expectMinCount: 2, mustExclude: ['Past Lives'], noticesMin: 1 },
  { name: 'note: korean please, quiz open', params: baseParams({ mood: 'Curious', genres: ['Mystery'], note: 'a korean movie please' }), expectMinCount: 2, every: (m) => assert.equal(m.language, 'ko') },
  { name: 'seen-it-all comedy short', params: baseParams({ mood: 'Tired', genres: ['Comedy'], maxRuntime: 'Under 90 min', excludeIds: [807, 10315, 862, 1104] }), mustExclude: ['Airplane!', 'Fantastic Mr. Fox', 'Toy Story', 'Office Space'], noticesMin: 1 },
  { name: 'solo horror opt-in', params: baseParams({ mood: 'Curious', genres: ['Horror'], preferences: { mature: true } }), expectCount: 2, mustInclude: ['What We Do in the Shadows', 'The Call'] },
  { name: 'partner romance classic', params: baseParams({ genres: ['Romance'], audience: 'Partner', preferences: { classics: true } }), mustInclude: ['Before Sunrise'], every: (m) => assert.ok(m.year < 2000) },
  { name: 'english documentary (gap)', params: baseParams({ mood: 'Curious', genres: ['Documentary'], languages: ['English'] }), expectMinCount: 1, noticesMin: 1 },
  { name: 'telugu night', params: baseParams({ genres: ['Action'], languages: ['Telugu'] }), mustInclude: ['RRR'] },
  { name: 'japanese night', params: baseParams({ genres: ['Animation'], languages: ['Japanese'] }), mustInclude: ['My Neighbor Totoro'] },
  { name: 'french night', params: baseParams({ genres: ['Romance'], languages: ['French'] }), mustInclude: ['Amélie'] },
  { name: 'spanish catalogue gap', params: baseParams({ languages: ['Spanish'], genres: ['Drama'] }), expectCount: 0, noticesMin: 1 },
  { name: 'recent thriller (relaxes to recent crime-adjacent)', params: baseParams({ genres: ['Thriller'], preferences: { recent: true } }), expectCount: 2, mustInclude: ['Decision to Leave', 'Past Lives'], noticesMin: 2 },
  { name: 'hidden gems for friends comedy', params: baseParams({ genres: ['Comedy'], audience: 'Friends', preferences: { hiddenGems: true } }), expectMinCount: 2, mustInclude: ['Office Space'] },
];

for (const q of QUERIES) {
  test(`query: ${q.name}`, async () => {
    const { items, notices } = await selectCandidateMovies(q.params);
    const got = titles(items);
    if (q.expectCount !== undefined) assert.equal(items.length, q.expectCount, `got [${got}]`);
    if (q.expectMinCount !== undefined) assert.ok(items.length >= q.expectMinCount, `got [${got}]`);
    for (const t of q.mustInclude || []) assert.ok(got.includes(t), `missing "${t}" in [${got}]`);
    for (const t of q.mustExclude || []) assert.ok(!got.includes(t), `"${t}" should be absent in [${got}]`);
    if (q.every) for (const { movie } of items) q.every(movie);
    if (q.noticesMin) assert.ok(notices.length >= q.noticesMin, `expected notices, got ${JSON.stringify(notices)}`);
  });
}
