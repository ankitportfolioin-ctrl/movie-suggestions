import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTitles } from '../server/titleSearch.js';

const INTERSTELLAR = {
  id: 157336, title: 'Interstellar', original_title: 'Interstellar',
  release_date: '2014-11-07', vote_average: 8.4, overview: 'Space epic.',
  poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', original_language: 'en',
};
const DARK_KNIGHT = {
  id: 155, title: 'The Dark Knight', original_title: 'The Dark Knight',
  release_date: '2008-07-18', vote_average: 8.5, overview: 'Batman.',
  poster_path: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', original_language: 'en',
};

const okFetch = (results: unknown[]) =>
  (async () => ({ ok: true, json: async () => ({ results }) }) as unknown as Response) as typeof fetch;

describe('exact-title search', () => {
  test('Interstellar resolves with year and media type', async () => {
    const r = await searchTitles('Interstellar', { tmdbKey: 'K', fetchFn: okFetch([INTERSTELLAR]) });
    assert.equal(r.status, 200);
    const [hit] = (r.body.results as { title: string; year: number; mediaType: string }[]);
    assert.equal(hit.title, 'Interstellar');
    assert.equal(hit.year, 2014);
    assert.equal(hit.mediaType, 'movie');
  });

  test('The Dark Knight resolves with year and media type', async () => {
    const r = await searchTitles('The Dark Knight', { tmdbKey: 'K', fetchFn: okFetch([DARK_KNIGHT]) });
    assert.equal(r.status, 200);
    const [hit] = (r.body.results as { title: string; year: number; mediaType: string }[]);
    assert.equal(hit.title, 'The Dark Knight');
    assert.equal(hit.year, 2008);
    assert.equal(hit.mediaType, 'movie');
  });

  test('genuine empty has no error field', async () => {
    const r = await searchTitles('zzz no such film', { tmdbKey: 'K', fetchFn: okFetch([]) });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results, []);
    assert.ok(!('error' in r.body));
  });

  test('upstream 500 is a retryable 502, not an empty success', async () => {
    const bad = (async () => ({ ok: false, status: 500 }) as unknown as Response) as typeof fetch;
    const r = await searchTitles('Interstellar', { tmdbKey: 'K', fetchFn: bad });
    assert.equal(r.status, 502);
    assert.equal((r.body as { retryable: boolean }).retryable, true);
    assert.ok(!('results' in r.body) || (r.body.results as unknown[]).length === 0);
  });

  test('fetch throw (timeout) is a retryable 502', async () => {
    const down = (() => { throw new Error('timeout'); }) as unknown as typeof fetch;
    const r = await searchTitles('Interstellar', { tmdbKey: 'K', fetchFn: down });
    assert.equal(r.status, 502);
    assert.equal((r.body as { retryable: boolean }).retryable, true);
  });

  test('malformed provider JSON is a retryable 502', async () => {
    const bad = (async () => ({
      ok: true, json: async () => { throw new Error('bad json'); },
    }) as unknown as Response) as typeof fetch;
    const r = await searchTitles('Interstellar', { tmdbKey: 'K', fetchFn: bad });
    assert.equal(r.status, 502);
  });

  test('records missing poster_date are dropped, posters go through /img', async () => {
    const r = await searchTitles('xy', { tmdbKey: 'K', fetchFn: okFetch([{ ...INTERSTELLAR, poster_path: null }, { ...DARK_KNIGHT, release_date: '' }, INTERSTELLAR]) });
    const results = r.body.results as { title: string; posterUrl: string }[];
    assert.equal(results.length, 1);
    assert.ok(results[0].posterUrl.startsWith('/img/'), results[0].posterUrl);
  });

  test('no key falls back to local catalog; diacritics match', async () => {
    const catalog = [{ id: 1, title: 'Amélie', year: 2001, genres: [], runtime: 122, rating: 8, voteCount: 0, popularity: 0, overview: '', posterUrl: '', language: 'fr', isMature: false, isHiddenGem: false, providers: [] }];
    const r = await searchTitles('amelie', { catalog });
    assert.equal(r.status, 200);
    assert.equal((r.body.results as { title: string }[])[0].title, 'Amélie');
    assert.equal(r.body.source, 'local');
  });

  test('empty, too-long and too-short queries are 400', async () => {
    assert.equal((await searchTitles('', {})).status, 400);
    assert.equal((await searchTitles('   ', {})).status, 400);
    assert.equal((await searchTitles('x'.repeat(121), {})).status, 400);
    const short = await searchTitles('a', {});
    assert.equal(short.status, 400);
    assert.equal((short.body as { error: string }).error, 'Type at least 2 characters');
  });

  test('whitespace is collapsed before search', async () => {
    let seen = '';
    const spy = (async (url: string) => {
      seen = url;
      return { ok: true, json: async () => ({ results: [] }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await searchTitles('  Interstellar   2014  ', { tmdbKey: 'K', fetchFn: spy });
    assert.ok(seen.includes('query=Interstellar%202014'), seen);
  });
});
