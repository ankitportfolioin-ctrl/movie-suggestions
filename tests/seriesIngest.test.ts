import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agesFromCountryCerts, isWebNetwork, keepMovie, keepSeries, tvRatings, voteFloor,
} from '../scripts/ingest-tmdb.mjs';

/** Narrow away the null branches of the keep* functions. */
function must<T>(v: T | null): T {
  assert.ok(v, 'expected a non-null value');
  return v as T;
}

describe('TV certificate mapping (content_ratings)', () => {
  const cr = (pairs: [string, string][]) => ({
    content_ratings: { results: pairs.map(([iso_3166_1, rating]) => ({ iso_3166_1, rating })) },
  });
  const byCountry = (r: { certByCountry: unknown }) => r.certByCountry as Record<string, string>;

  test('US TV ratings map like their movie counterparts by country', () => {
    const us = tvRatings(cr([['US', 'TV-MA'], ['GB', '18'], ['DE', '16']]));
    assert.equal(us.minAge, 16);
    assert.equal(byCountry(us).US, 'TV-MA');
    const pg = tvRatings(cr([['US', 'TV-PG']]));
    assert.equal(pg.minAge, 6);
    const tvy = tvRatings(cr([['US', 'TV-Y7']]));
    assert.equal(tvy.minAge, 6);
    const tvg = tvRatings(cr([['US', 'TV-G']]));
    assert.equal(tvg.minAge, 0);
    const tv14 = tvRatings(cr([['US', 'TV-14']]));
    assert.equal(tv14.minAge, 12);
  });

  test('"A" maps per country: IN adult-only vs MX all-ages', () => {
    assert.equal(tvRatings(cr([['IN', 'A']])).minAge, 18);
    assert.equal(tvRatings(cr([['MX', 'A']])).minAge, 0);
  });

  test('median across countries, US/GB/DE 16+ floor, strictest cert + adult votes', () => {
    const r = tvRatings(cr([
      ['US', 'TV-14'], ['GB', '15'], ['DE', '16'], ['IN', 'UA 16+'],
      ['MX', 'A'], ['FR', '-12'], ['KR', '15'],
    ]));
    assert.equal(r.minAge, 16);
    assert.equal(r.minAgeStrict, 16);
    assert.equal(r.certificate, '15'); // first strictest cert seen
    assert.equal(r.adultVotes, 0);
    assert.deepEqual(byCountry(r), {
      US: 'TV-14', GB: '15', DE: '16', IN: 'UA 16+', MX: 'A', FR: '-12', KR: '15',
    });
    const hard = tvRatings(cr([['US', 'TV-MA'], ['IN', 'A'], ['MX', 'A'], ['GB', '18']]));
    assert.equal(hard.minAge, 18); // median 17 snaps up to 18
    assert.equal(hard.adultVotes, 2);
  });

  test('empty or unmappable ratings yield nulls, never a guessed age', () => {
    const none = tvRatings({});
    assert.equal(none.minAge, null);
    assert.equal(none.certificate, '');
    assert.equal(none.minAgeStrict, null);
    const junk = tvRatings(cr([['US', 'NOT-A-CERT']]));
    assert.equal(junk.minAge, null);
  });

  test('agesFromCountryCerts is the shared core for movies and TV', () => {
    const viaPairs = agesFromCountryCerts([{ iso: 'US', cert: 'R' }, { iso: 'DE', cert: 'FSK 12' }]);
    assert.equal(viaPairs.minAge, 16); // US R floor
    assert.equal(byCountry(viaPairs).US, 'R');
  });
});

describe('web-series tagging', () => {
  test('streaming-first networks count, broadcast networks do not', () => {
    assert.equal(isWebNetwork('YouTube'), true);
    assert.equal(isWebNetwork('youtube'), true);
    assert.equal(isWebNetwork('Netflix'), true);
    assert.equal(isWebNetwork('HBO'), false);
    assert.equal(isWebNetwork('BBC One'), false);
    assert.equal(isWebNetwork(null), false);
  });
});

describe('keepSeries', () => {
  const show = (over = {}) => ({
    id: 100, name: 'Test Show', original_name: 'Test Show', adult: false,
    first_air_date: '2019-04-01', last_air_date: '2023-06-01', overview: 'plot',
    poster_path: '/p.jpg', vote_average: 8.1, vote_count: 500,
    original_language: 'en', genres: [{ name: 'Drama' }],
    networks: [{ name: 'HBO' }], episode_run_time: [55],
    number_of_seasons: 4, number_of_episodes: 38, status: 'Ended',
    content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
    keywords: { results: [{ name: 'x' }] },
    ...over,
  });

  test('maps series fields: seasons, episodes, episode runtime, network, years', () => {
    const s = keepSeries(show());
    assert.ok(s);
    assert.equal(s.type, 'series');
    assert.equal(s.title, 'Test Show');
    assert.equal(s.year, 2019);
    assert.equal(s.firstAirYear, 2019);
    assert.equal(s.lastAirYear, 2023);
    assert.equal(s.runtime, 55);
    assert.equal(s.episodeRuntime, 55);
    assert.equal(s.seasons, 4);
    assert.equal(s.episodes, 38);
    assert.equal(s.network, 'HBO');
    assert.equal(s.webSeries, false);
    assert.equal(s.status, 'Ended');
    assert.equal(s.minAge, 16);
  });

  test('web-first networks are tagged and pass the lower vote floor', () => {
    const web = must(keepSeries(show({ vote_count: 6, networks: [{ name: 'YouTube' }] })));
    assert.equal(web.webSeries, true);
    const broadcast = keepSeries(show({ vote_count: 6, networks: [{ name: 'HBO' }] }));
    assert.equal(broadcast, null); // 6 < 100 for a big-language broadcast show
  });

  test('TMDB TV genres that bundle two app genres are split', () => {
    const s = must(keepSeries(show({ genres: [{ name: 'Sci-Fi & Fantasy' }, { name: 'Action & Adventure' }] })));
    assert.deepEqual(s.genres, ['Sci-Fi', 'Fantasy', 'Action', 'Adventure']);
  });

  test('rejects missing overview/rating/date and adult shows', () => {
    assert.equal(keepSeries(show({ overview: '' })), null);
    assert.equal(keepSeries(show({ vote_average: 0 })), null);
    assert.equal(keepSeries(show({ first_air_date: null })), null);
    assert.equal(keepSeries(show({ adult: true })), null);
    assert.equal(keepSeries(show({ genres: [] })), null);
  });

  test('unknown episode runtime keeps the row with runtime 0 (no crash)', () => {
    const s = must(keepSeries(show({ episode_run_time: [] })));
    assert.equal(s.runtime, 0);
    assert.equal(s.episodeRuntime, null);
  });

  test('vote floors stay consistent with the dry-run rule', () => {
    assert.equal(voteFloor('series', 'en', true), 5);
    assert.equal(voteFloor('series', 'en', false), 100);
    assert.equal(voteFloor('series', 'xx', false), 20);
  });
});

describe('keepMovie typing', () => {
  const film = (over = {}) => ({
    id: 5, title: 'Film', adult: false, release_date: '2015-01-01',
    runtime: 95, overview: 'plot', poster_path: '/p.jpg', vote_average: 7,
    vote_count: 500, original_language: 'en', genres: [{ name: 'Drama' }],
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] },
    keywords: { keywords: [] },
    ...over,
  });

  test('runtime splits shorts (1-40) from movies (41+)', () => {
    assert.equal(must(keepMovie(film(), 'movie')).type, 'movie');
    assert.equal(keepMovie(film({ runtime: 25 }), 'movie'), null);
    assert.equal(must(keepMovie(film({ runtime: 25 }), 'short')).type, 'short');
    assert.equal(keepMovie(film(), 'short'), null);
  });

  test('vote floors apply at detail time', () => {
    assert.equal(keepMovie(film({ vote_count: 99 }), 'movie'), null);
    assert.equal(must(keepMovie(film({ vote_count: 99, original_language: 'xx' }), 'movie')).type, 'movie');
    assert.equal(must(keepMovie(film({ runtime: 20, vote_count: 5 }), 'short')).type, 'short');
    assert.equal(keepMovie(film({ runtime: 20, vote_count: 4 }), 'short'), null);
  });
});
