import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTitlePage, renderSitemap, robotsTxt, escapeHtml, safeJsonLd, isImdbId, isTitleId,
  titleIdFor, ageLabel, truncateAtWord, localLogo, type TitleRow,
} from '../server/titlePages.js';
import { renderPrivacyPage, renderTermsPage } from '../server/legalPages.js';
import { parseDetails, resolveRegion } from '../server/tmdbDetails.js';

const t: TitleRow = {
  tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception <b>"x"</b>', year: 2010, type: 'movie', runtime: 148,
  genres: ['Action', 'Sci-Fi'], overview: 'A thief </script><script>alert(1)</script> steals secrets.',
  rating: 8.4, votes: 2400000, posterPath: '/abc.jpg', certificate: 'PG-13', minAge: 12, seasons: null, language: 'en',
};

test('title page escapes user-controlled text and cannot break out of JSON-LD', () => {
  const html = renderTitlePage(t, [], 'https://x.test');
  assert.ok(!html.includes('<b>"x"</b>'));
  assert.ok(!html.includes('</script><script>alert(1)'));
  assert.match(html, /<link rel="canonical" href="https:\/\/x\.test\/title\/tt1375666">/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type":"Movie"/);
});

test('series pages use TVSeries, season facts and the s<tmdbId> url', () => {
  const html = renderTitlePage({ ...t, imdbId: null, tmdbId: 1396, type: 'series', seasons: 3, runtime: 45 }, [], 'https://x.test');
  assert.match(html, /"@type":"TVSeries"/);
  assert.match(html, /3 seasons/);
  assert.match(html, /title\/s1396/);
});

test('similar titles link by imdb id or s<tmdbId>; rows with no usable id are skipped', () => {
  const html = renderTitlePage(t, [
    { tmdbId: 603, imdbId: 'tt0133093', title: 'The Matrix', year: 1999, type: 'movie', rating: 8.2, posterPath: '/m.jpg' },
    { tmdbId: 1399, imdbId: null, title: 'Game of Thrones', year: 2011, type: 'series', rating: 8.4, posterPath: '/g.jpg' },
    { tmdbId: 5, imdbId: null, title: 'No id movie', year: 2000, type: 'movie', rating: 5, posterPath: '/n.jpg' },
  ], 'https://x.test');
  assert.match(html, /href="\/title\/tt0133093"/);
  assert.match(html, /href="\/title\/s1399"/);
  assert.ok(!html.includes('No id movie'));
});

test('extras render providers (with attribution), cast, director and trailer; absent extras render nothing', () => {
  const extras = parseDetails({
    'watch/providers': { results: { US: { link: 'https://tmdb.test/w', flatrate: [{ provider_name: 'Netflix', logo_path: '/n.jpg' }], rent: [{ provider_name: 'Apple TV', logo_path: '/a.jpg' }] } } },
    credits: { cast: [{ name: 'Leo', character: 'Cobb' }], crew: [{ job: 'Director', name: 'Chris' }] },
    videos: { results: [{ site: 'YouTube', type: 'Trailer', official: true, key: 'YoHD9XEInc0' }] },
  }, 'US');
  const html = renderTitlePage(t, [], 'https://x.test', extras);
  assert.match(html, /Where to watch/);
  assert.match(html, /Netflix/);
  assert.match(html, /JustWatch/);
  assert.match(html, /\/img\/w92\/tmdb\/n\.jpg/);
  assert.match(html, /Cast/);
  assert.match(html, /Directed by Chris/);
  assert.match(html, /youtube\.com\/watch\?v=YoHD9XEInc0/);
  const bare = renderTitlePage(t, [], 'https://x.test', null);
  assert.ok(!bare.includes('Where to watch') && !bare.includes('Watch trailer'));
});

test('parseDetails: ordering, de-dupe, junk tolerance, creators fallback', () => {
  const x = parseDetails({
    'watch/providers': { results: { IN: { buy: [{ provider_name: 'B', logo_path: '/b' }], flatrate: [{ provider_name: 'S', logo_path: '/s' }, { provider_name: 'S', logo_path: '/s' }, { provider_name: 'NoLogo' }] } } },
    created_by: [{ name: 'Creator' }],
    videos: { results: [{ site: 'Vimeo', key: 'abc12345' }, { site: 'YouTube', type: 'Teaser', key: 'bad key!' }] },
  }, 'IN');
  assert.deepEqual(x.providers.map((p) => `${p.type}:${p.name}`), ['Stream:S', 'Buy:B']);
  assert.equal(x.director, 'Creator');
  assert.equal(x.trailerUrl, null);
  assert.deepEqual(parseDetails({}, 'US').providers, []);
  assert.equal(parseDetails(null, 'US').cast.length, 0);
});

test('region + logo helpers', () => {
  assert.equal(resolveRegion('in'), 'IN');
  assert.equal(resolveRegion('../x'), process.env.WATCH_REGION || process.env.WATCHMODE_REGION ? resolveRegion() : 'US');
  assert.equal(localLogo('https://image.tmdb.org/t/p/w92/a.jpg'), '/img/w92/tmdb/a.jpg');
  assert.equal(localLogo('https://evil.test/a.jpg'), '');
});

test('sitemap lists only valid ids (movie + series); robots points at it', () => {
  const xml = renderSitemap(['tt1375666', 's1396', 'nope', '../x', 's1;drop'], 'https://x.test');
  assert.match(xml, /title\/tt1375666/);
  assert.match(xml, /title\/s1396/);
  assert.ok(!xml.includes('nope') && !xml.includes('../x') && !xml.includes('drop'));
  assert.match(robotsTxt('https://x.test'), /Sitemap: https:\/\/x\.test\/sitemap\.xml/);
});

test('ids and helpers', () => {
  assert.equal(isImdbId('tt1375666'), true);
  assert.equal(isImdbId("tt1'; drop"), false);
  assert.equal(isTitleId('s123'), true);
  assert.equal(isTitleId('s'), false);
  assert.equal(titleIdFor({ imdbId: null, tmdbId: 9, type: 'series' }), 's9');
  assert.equal(titleIdFor({ imdbId: null, tmdbId: 9, type: 'movie' }), null);
  assert.equal(escapeHtml(`<&"'>`), '&lt;&amp;&quot;&#39;&gt;');
  assert.ok(!safeJsonLd({ a: '</script>' }).includes('<'));
  assert.equal(ageLabel({ minAge: null }), 'Rating not confirmed');
  assert.equal(ageLabel({ minAge: 6 }), 'All ages');
  assert.equal(ageLabel({ minAge: 16 }), '16+');
});

test('descriptions are cut at a word boundary with an ellipsis', () => {
  const out = truncateAtWord('word '.repeat(80), 200);
  assert.ok(out.length <= 200 && out.endsWith('…') && !out.endsWith(' …'));
  assert.equal(truncateAtWord('short text', 200), 'short text');
});

test('legal pages render, disclose the real data practices and escape the contact email', () => {
  const p = renderPrivacyPage();
  assert.match(p, /local storage/i);
  assert.match(p, /hash of your IP/i);
  assert.match(p, /approximate location/i);
  assert.match(renderTermsPage(), /Rating not confirmed/);
  process.env.CONTACT_EMAIL = 'a@b.co';
  assert.match(renderPrivacyPage(), /mailto:a@b\.co/);
  process.env.CONTACT_EMAIL = '"><script>x</script>@b.co';
  assert.ok(!renderPrivacyPage().includes('<script>x'));
  delete process.env.CONTACT_EMAIL;
});
