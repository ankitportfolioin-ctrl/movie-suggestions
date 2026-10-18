import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BIG_LANGS, DRY_MAX_PAGES, TV_GENRE_IDS, buildSlices, dryRunEstimate,
  dryRunQuality, dryRunScan, dryRunSummary, parseSampleSize, parseTarget, parseTypesArg, parseYears, voteFloor,
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

  test('target defaults to 60000 and parses valid values', () => {
    assert.equal(parseTarget([]), 60000);
    assert.equal(parseTarget(['--target', '50000']), 50000);
    assert.equal(parseTarget(['--target=75000']), 75000);
    assert.throws(() => parseTarget(['--target', '0']));
    assert.throws(() => parseTarget(['--target', '-1']));
  });

  test('sample-size defaults to 500 and parses valid values', () => {
    assert.equal(parseSampleSize([]), 500);
    assert.equal(parseSampleSize(['--sample-size', '1000']), 1000);
    assert.equal(parseSampleSize(['--sample-size=200']), 200);
    assert.throws(() => parseSampleSize(['--sample-size', '0']));
    assert.throws(() => parseSampleSize(['--sample-size', '-5']));
  });
});

describe('dry-run quality rule', () => {
  const row = (over = {}) => ({
    id: 1, overview: 'plot', poster_path: '/p.jpg', vote_average: 7.5,
    vote_count: 500, adult: false, original_language: 'en', ...over,
  });

  test('vote floors: tiered by year and language', () => {
    // Indian languages: 10 votes max (regardless of year)
    assert.equal(voteFloor('movie', 'hi', false, 2020), 10);
    assert.equal(voteFloor('movie', 'ta', false, 2020), 10);
    assert.equal(voteFloor('movie', 'te', false, 2020), 10);
    assert.equal(voteFloor('movie', 'ml', false, 2020), 10);
    assert.equal(voteFloor('movie', 'kn', false, 2020), 10);
    assert.equal(voteFloor('movie', 'bn', false, 2020), 10);
    assert.equal(voteFloor('movie', 'mr', false, 2020), 10);
    assert.equal(voteFloor('movie', 'pa', false, 2020), 10);
    assert.equal(voteFloor('movie', 'ur', false, 2020), 10);
    // Indian languages in recent years: 5 votes (5 < 10)
    assert.equal(voteFloor('movie', 'hi', false, 2025), 5);
    assert.equal(voteFloor('movie', 'hi', false, 2026), 5);
    // Big languages, older than 2 years: 100
    assert.equal(voteFloor('movie', 'en', false, 2020), 100);
    assert.equal(voteFloor('movie', 'es', false, 2020), 100);
    assert.equal(voteFloor('movie', 'fr', false, 2020), 100);
    // Big languages, last 2 years (2025-2026): 5
    assert.equal(voteFloor('movie', 'en', false, 2025), 5);
    assert.equal(voteFloor('movie', 'en', false, 2026), 5);
    // Other languages, older than 2 years: 20
    assert.equal(voteFloor('movie', 'xx', false, 2020), 20);
    // Other languages, last 2 years: 5
    assert.equal(voteFloor('movie', 'xx', false, 2025), 5);
    assert.equal(voteFloor('movie', 'xx', false, 2026), 5);
    // Shorts follow same tiered rules
    assert.equal(voteFloor('short', 'en', false, 2020), 100);
    assert.equal(voteFloor('short', 'en', false, 2025), 5);
  });

  test('missing overview/poster/rating, adult and low votes are rejected', () => {
    assert.equal(dryRunQuality(row(), 'movie', 'en', 2020), true);
    assert.equal(dryRunQuality(row({ overview: '' }), 'movie', 'en', 2020), false);
    assert.equal(dryRunQuality(row({ poster_path: null }), 'movie', 'en', 2020), false);
    assert.equal(dryRunQuality(row({ vote_average: 0 }), 'movie', 'en', 2020), false);
    assert.equal(dryRunQuality(row({ adult: true }), 'movie', 'en', 2020), false);
    // English movie 2020 needs 100 votes
    assert.equal(dryRunQuality(row({ vote_count: 99 }), 'movie', 'en', 2020), false);
    assert.equal(dryRunQuality(row({ vote_count: 100 }), 'movie', 'en', 2020), true);
    // Other language 2020 needs 20 votes
    assert.equal(dryRunQuality(row({ vote_count: 20 }), 'movie', 'xx', 2020), true);
    // Recent year (2025) needs 5 votes for any language
    assert.equal(dryRunQuality(row({ vote_count: 5 }), 'movie', 'en', 2025), true);
    assert.equal(dryRunQuality(row({ vote_count: 4 }), 'movie', 'en', 2025), false);
    // Indian language capped at 10
    assert.equal(dryRunQuality(row({ vote_count: 10 }), 'movie', 'hi', 2020), true);
    assert.equal(dryRunQuality(row({ vote_count: 9 }), 'movie', 'hi', 2020), false);
  });
});

describe('dry-run slices', () => {
  test('movie/short/series families use two sorts and the right discover path', () => {
    const movie = buildSlices(['movie'], 2000, 2001);
    // New slice design: year-only, year×target-lang, year×genre, year×quarters (for 2020+),
    // other-langs-full-range, genre-full-range. All ×2 sorts.
    // For 2000-2001 (2 years, pre-2020 so no quarters):
    // 2 years × 2 sorts = 4 (year-only)
    // 2 years × 11 target-langs × 2 = 44 (year×lang)
    // 2 years × 18 genres × 2 = 72 (year×genre)
    // 16 other-langs × 2 = 32 (lang full range)
    // 18 genres × 2 = 36 (genre full range)
    // Total = 4 + 44 + 72 + 32 + 36 = 188
    assert.equal(movie.length, 188);
    assert.equal(movie[0].path, '/discover/movie');
    assert.equal(movie[0].params.primary_release_year, '2000');
    assert.equal(movie[0].params['with_runtime.gte'], '41');
    const short = buildSlices(['short'], 2000, 2000);
    assert.equal(short[0].params['with_runtime.lte'], '40');
    // short: 1 year × 2 + 1×11×2 + 1×18×2 + 16×2 + 18×2 = 2+22+36+32+36 = 128
    assert.equal(short.length, 128);
    const series = buildSlices(['series'], 2000, 2000);
    // series: 1 year × 2 + 1×11×2 + 1×16×2 + 16×2 + 16×2 = 2+22+32+32+32 = 120
    assert.equal(series.length, 120);
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
  const SLICE = buildSlices(['movie'], 2000, 2000)[0];
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

  test('counts new ids once, buckets year/language/type, stops ONLY on empty page or past total_pages', async () => {
    const { getPage, calls } = oneSlice([
      [good(1), good(2, { original_language: 'hi', release_date: '2015-01-01' })],
      [good(1), good(1)], // nothing new, but page has results -> continue
      [good(3)],
      [], // empty page -> stop here
    ]);
    const scan = await dryRunScan(getPage, { ...scanOpts, types: ['movie'], fromYear: 2000, toYear: 2000 });
    // Finds 3 unique ids (1, 2, 3) across 3 non-empty pages
    assert.equal(scan.found.size, 3);
    assert.equal(calls().length, 4); // fetches all 4 pages (3 with data, 1 empty)
    const { byType, byYear, byLang } = dryRunSummary(scan.found);
    assert.equal(byType.movie, 3);
    assert.equal(byYear.get(2010)!.movie, 2); // ids 1 and 3 are 2010
    assert.equal(byYear.get(2015)!.movie, 1); // id 2 is 2015
    assert.equal(byLang.get('en')!.movie, 2);
    assert.equal(byLang.get('hi')!.movie, 1);
  });

  test('ids already in the DB are counted as hits once, never as new - continues past known ids', async () => {
    const { getPage, calls } = oneSlice([[good(7), good(8)], [good(7)], [good(9)], []]);
    const scan = await dryRunScan(getPage,
      { ...scanOpts, seen: new Set([7, 8]), types: ['movie'], fromYear: 2000, toYear: 2000 });
    // Page 1: 7,8 are in DB -> dbIds=2, found=0
    // Page 2: 7 is in DB -> dbIds=2, found=0
    // Page 3: 9 is new -> found=1
    // Page 4: empty -> stop
    assert.equal(scan.found.size, 1); // only id 9 is new
    assert.equal(scan.dbIds.size, 2); // 7 and 8 counted once each
    assert.equal(calls().length, 4); // continues through all pages until empty
  });

  test('rows failing the quality rule do not count but DO keep a page alive', async () => {
    const { getPage, calls } = oneSlice([
      [good(1)],
      [good(2, { vote_count: 3 })], // below the 'en' floor of 100 (year 2010)
      [good(3)],
      [], // empty page -> stop
    ]);
    const scan = await dryRunScan(getPage, { ...scanOpts, types: ['movie'], fromYear: 2000, toYear: 2000 });
    // Page 1: id 1 passes
    // Page 2: id 2 fails quality, but page has results -> continue
    // Page 3: id 3 passes
    // Page 4: empty -> stop
    assert.equal(scan.found.size, 2); // ids 1 and 3
    assert.equal(calls().length, 4); // fetches all 4 pages
  });

  test('stops at total_pages even if not empty', async () => {
    const calls: { pathname: string; page: string }[] = [];
    const getPage = async (pathname: string, params: Record<string, string>) => {
      calls.push({ pathname, page: params.page });
      const page = Number(params.page);
      if (page === 1) return { results: [good(1), good(2)], total_pages: 2 };
      if (page === 2) return { results: [good(3)], total_pages: 2 };
      return { results: [], total_pages: 2 };
    };
    const scan = await dryRunScan(getPage, { ...scanOpts, types: ['movie'], fromYear: 2000, toYear: 2000 });
    assert.equal(scan.found.size, 3);
    assert.equal(calls.length, 2); // stops at total_pages=2
  });

  test('estimate: detail calls + discover calls at 12 req/s', () => {
    const est = dryRunEstimate(1200, 100);
    assert.equal(est.detailCalls, 1200);
    assert.equal(est.discoverCalls, 100);
    assert.equal(est.totalCalls, 1300);
    assert.equal(est.seconds, 1300 / 12);
  });
});
