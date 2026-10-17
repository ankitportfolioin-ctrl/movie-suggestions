import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BIG_LANGS, DRY_MAX_PAGES, TV_GENRE_IDS, buildDryRunSlices, dryRunEstimate,
  dryRunQuality, dryRunScan, dryRunSummary, parseTypesArg, parseYears, voteFloor,
} from '../scripts/ingest-tmdb.mjs';

describe('dry-run argument parsing', () => {
  test('years accept a range or a single year', () => {
    assert.deepEqual(parseYears('2000-2026'), { from: 2000, to: 2026 });
    assert.deepEqual(parseYears('2019'), { from: 2019, to: 2019 });
    assert.throws(() => parseYears('2026-2000'));
    assert.throws(() => parseYears('nope'));
  });

  test('types accept the three kinds, reject junk and dedupe', () => {
    assert.deepEqual(parseTypesArg('movie,short,series'), ['movie', 'short', 'series']);
    assert.deepEqual(parseTypesArg('series,series'), ['series']);
    assert.throws(() => parseTypesArg('film'));
    assert.throws(() => parseTypesArg(''));
  });
});

describe('dry-run quality rule', () => {
  const row = (over = {}) => ({
    id: 1, overview: 'plot', poster_path: '/p.jpg', vote_average: 7.5,
    vote_count: 500, adult: false, original_language: 'en', ...over,
  });

  test('vote floors: 100 big languages, 20 others, 5 shorts/web series', () => {
    assert.equal(voteFloor('movie', 'en'), 100);
    assert.equal(voteFloor('movie', 'hi'), 100);
    assert.equal(voteFloor('movie', 'xx'), 20);
    assert.equal(voteFloor('short', 'en'), 5);
    assert.equal(voteFloor('series', 'en', true), 5);
    assert.equal(voteFloor('series', 'en'), 100);
  });

  test('missing overview/poster/rating, adult and low votes are rejected', () => {
    assert.equal(dryRunQuality(row(), 'movie', 'en'), true);
    assert.equal(dryRunQuality(row({ overview: '' }), 'movie', 'en'), false);
    assert.equal(dryRunQuality(row({ poster_path: null }), 'movie', 'en'), false);
    assert.equal(dryRunQuality(row({ vote_average: 0 }), 'movie', 'en'), false);
    assert.equal(dryRunQuality(row({ adult: true }), 'movie', 'en'), false);
    assert.equal(dryRunQuality(row({ vote_count: 99 }), 'movie', 'en'), false);
    assert.equal(dryRunQuality(row({ vote_count: 20 }), 'movie', 'xx'), true);
    assert.equal(dryRunQuality(row({ vote_count: 7 }), 'short', 'en'), true);
  });
});

describe('dry-run slices', () => {
  test('movie/short/series families use two sorts and the right discover path', () => {
    const movie = buildDryRunSlices(['movie'], 2000, 2001);
    // 2 years + BIG_LANGS + 18 movie genres, x2 sorts.
    assert.equal(movie.length, (2 + BIG_LANGS.length + 18) * 2);
    assert.equal(movie[0].path, '/discover/movie');
    assert.equal(movie[0].params.primary_release_year, '2000');
    assert.equal(movie[0].params['with_runtime.gte'], '41');
    const short = buildDryRunSlices(['short'], 2000, 2000);
    assert.equal(short[0].params['with_runtime.lte'], '40');
    const series = buildDryRunSlices(['series'], 2000, 2000);
    assert.equal(series.length, (1 + BIG_LANGS.length + Object.keys(TV_GENRE_IDS).length) * 2);
    assert.equal(series[0].path, '/discover/tv');
    assert.equal(series[0].params.first_air_date_year, '2000');
    assert.equal(series[0].params.primary_release_year, undefined);
  });

  test('page depth cap is 25', () => {
    assert.equal(DRY_MAX_PAGES, 25);
  });
});

describe('dry-run scan', () => {
  const good = (id: number, over: Record<string, unknown> = {}) => ({
    id, overview: 'plot', poster_path: '/p.jpg', vote_average: 7,
    vote_count: 500, adult: false, original_language: 'en',
    release_date: '2010-05-01', ...over,
  });
  // One slice only: the year family of a single year, first sort order.
  const SLICE = buildDryRunSlices(['movie'], 2000, 2000)[0];
  const oneSlice = (rowsByPage: Record<string, unknown>[][]) => {
    const calls: { pathname: string; page: string }[] = [];
    const getPage = async (pathname: string, params: Record<string, string>) => {
      calls.push({ pathname, page: params.page });
      const rows = rowsByPage[Number(params.page) - 1] || [];
      return { results: rows, total_pages: 10 };
    };
    return { getPage, calls: () => calls };
  };
  const scanOpts = { seen: new Set<number>(), slices: [SLICE] };

  test('counts new ids once, buckets year/language/type, stops on an empty page', async () => {
    const { getPage, calls } = oneSlice([
      [good(1), good(2, { original_language: 'hi', release_date: '2015-01-01' })],
      [good(1), good(1)], // nothing new -> scan stops after this page
      [good(3)],
    ]);
    const scan = await dryRunScan(getPage, { ...scanOpts, types: ['movie'], fromYear: 2000, toYear: 2000 });
    assert.equal(scan.found.size, 2);
    assert.equal(calls().length, 2); // page 3 never fetched
    const { byType, byYear, byLang } = dryRunSummary(scan.found);
    assert.equal(byType.movie, 2);
    assert.equal(byYear.get(2010)!.movie, 1);
    assert.equal(byYear.get(2015)!.movie, 1);
    assert.equal(byLang.get('en')!.movie, 1);
    assert.equal(byLang.get('hi')!.movie, 1);
  });

  test('ids already in the DB are counted as hits once, never as new', async () => {
    const { getPage, calls } = oneSlice([[good(7), good(8)], [good(7)]]);
    const scan = await dryRunScan(getPage,
      { ...scanOpts, seen: new Set([7, 8]), types: ['movie'], fromYear: 2000, toYear: 2000 });
    assert.equal(scan.found.size, 0);
    assert.equal(scan.dbIds.size, 2);
    assert.equal(calls().length, 1); // page 1 added no new id, so it stopped there
  });

  test('rows failing the quality rule do not count and cannot keep a page alive', async () => {
    const { getPage, calls } = oneSlice([
      [good(1)],
      [good(2, { vote_count: 3 })], // below the 'en' floor of 100
      [good(3)],
    ]);
    const scan = await dryRunScan(getPage, { ...scanOpts, types: ['movie'], fromYear: 2000, toYear: 2000 });
    assert.equal(scan.found.size, 1);
    assert.equal(calls().length, 2);
  });

  test('estimate: detail calls + discover calls at 12 req/s', () => {
    const est = dryRunEstimate(1200, 100);
    assert.equal(est.detailCalls, 1200);
    assert.equal(est.discoverCalls, 100);
    assert.equal(est.totalCalls, 1300);
    assert.equal(est.seconds, 1300 / 12);
  });
});
