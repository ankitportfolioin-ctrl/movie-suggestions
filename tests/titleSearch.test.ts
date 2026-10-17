import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSuggestions, searchTitles } from '../server/titleSearch.js';

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

  test('upstream 429 stays a retryable 429', async () => {
    const limited = (async () => ({ ok: false, status: 429 }) as unknown as Response) as typeof fetch;
    const r = await searchTitles('Interstellar', { tmdbKey: 'K', fetchFn: limited });
    assert.equal(r.status, 429);
    assert.equal((r.body as { retryable: boolean }).retryable, true);
  });

  test('Dune with year passes through to the provider query', async () => {
    let seen = '';
    const spy = (async (url: string) => {
      seen = url;
      return { ok: true, json: async () => ({ results: [] }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const r = await searchTitles('Dune 2021', { tmdbKey: 'K', fetchFn: spy });
    assert.ok(seen.includes('query=Dune%202021'), seen);
    assert.equal(r.status, 200);
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

  test('punctuated title passes through encoded', async () => {
    let seen = '';
    const spy = (async (url: string) => {
      seen = url;
      return { ok: true, json: async () => ({ results: [] }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const r = await searchTitles('Spider-Man: Into the Spider-Verse', { tmdbKey: 'K', fetchFn: spy });
    assert.ok(seen.includes('query=Spider-Man%3A%20Into%20the%20Spider-Verse'), seen);
    assert.equal(r.status, 200);
  });
});

describe('reference-title suggestions (OMDb)', () => {
  const omdbOk = (body: unknown) =>
    (async () => ({ ok: true, json: async () => body }) as unknown as Response) as typeof fetch;

  test('chips carry real IMDb ids the reference pipeline can resolve', async () => {
    const r = await searchSuggestions('arrival', {
      omdbKey: 'K',
      fetchFn: omdbOk({
        Response: 'True',
        Search: [
          { imdbID: 'tt2543164', Title: 'Arrival', Year: '2016', Poster: 'https://m.media-amazon.com/images/M/x.jpg' },
          { imdbID: 'tt1234567', Title: 'Arrival II', Year: '2017', Poster: 'N/A' },
        ],
      }),
    });
    assert.equal(r.status, 200);
    const results = r.body.results as { imdbId: string; title: string; year: number; posterUrl: string }[];
    assert.equal(results.length, 2);
    assert.equal(results[0].imdbId, 'tt2543164');
    assert.equal(results[0].year, 2016);
    assert.ok(results[0].posterUrl.startsWith('/img/'), results[0].posterUrl);
    assert.equal(results[1].posterUrl, '');
    assert.ok(results.every((x) => /^tt\d+$/.test(x.imdbId)));
  });

  test('OMDb "not found" is a genuine empty result', async () => {
    const r = await searchSuggestions('zzzz', {
      omdbKey: 'K',
      fetchFn: omdbOk({ Response: 'False', Error: 'Movie not found!' }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results, []);
  });

  test('any other OMDb failure is a retryable 502, never an empty success', async () => {
    const r = await searchSuggestions('arrival', {
      omdbKey: 'K',
      fetchFn: omdbOk({ Response: 'False', Error: 'Invalid API key!' }),
    });
    assert.equal(r.status, 502);
    assert.equal((r.body as { retryable: boolean }).retryable, true);
    assert.ok(!('results' in r.body));
  });

  test('records without a real tt id are dropped', async () => {
    const r = await searchSuggestions('arrival', {
      omdbKey: 'K',
      fetchFn: omdbOk({
        Response: 'True',
        Search: [{ imdbID: 'nm000003', Title: 'Arrival' }, { imdbID: 'tt2543164', Title: 'Arrival' }],
      }),
    });
    assert.equal((r.body.results as unknown[]).length, 1);
  });

  test('no key and upstream 429 stay honest errors', async () => {
    assert.equal((await searchSuggestions('arrival', {})).status, 502);
    const limited = (async () => ({ ok: false, status: 429 }) as unknown as Response) as typeof fetch;
    const r = await searchSuggestions('arrival', { omdbKey: 'K', fetchFn: limited });
    assert.equal(r.status, 429);
    assert.equal((r.body as { retryable: boolean }).retryable, true);
  });

  test('short query is a 400, query is trimmed in the provider call', async () => {
    assert.equal((await searchSuggestions('a', { omdbKey: 'K' })).status, 400);
    let seen = '';
    const spy = (async (url: string) => {
      seen = url;
      return { ok: true, json: async () => ({ Response: 'True', Search: [] }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await searchSuggestions('  arrival  ', { omdbKey: 'K', fetchFn: spy });
    assert.ok(seen.includes('s=arrival'), seen);
  });
});
