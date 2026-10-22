import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTitlePage, renderSitemap, robotsTxt, escapeHtml, safeJsonLd, isImdbId, ageLabel, type TitleRow } from '../server/titlePages.js';

const t: TitleRow = {
  imdbId: 'tt1375666', title: 'Inception <b>"x"</b>', year: 2010, type: 'movie', runtime: 148,
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

test('series pages use TVSeries and season facts', () => {
  const html = renderTitlePage({ ...t, type: 'series', seasons: 3, runtime: 45 }, [], 'https://x.test');
  assert.match(html, /"@type":"TVSeries"/);
  assert.match(html, /3 seasons/);
});

test('similar titles are linked as /title/<id>', () => {
  const html = renderTitlePage(t, [{ imdbId: 'tt0133093', title: 'The Matrix', year: 1999, type: 'movie', rating: 8.2, posterPath: '/m.jpg' }], 'https://x.test');
  assert.match(html, /href="\/title\/tt0133093"/);
});

test('sitemap lists only valid imdb ids; robots points at it', () => {
  const xml = renderSitemap(['tt1375666', 'nope', '../x'], 'https://x.test');
  assert.match(xml, /title\/tt1375666/);
  assert.ok(!xml.includes('nope') && !xml.includes('../x'));
  assert.match(robotsTxt('https://x.test'), /Sitemap: https:\/\/x\.test\/sitemap\.xml/);
});

test('helpers', () => {
  assert.equal(isImdbId('tt1375666'), true);
  assert.equal(isImdbId("tt1'; drop"), false);
  assert.equal(escapeHtml(`<&"'>`), '&lt;&amp;&quot;&#39;&gt;');
  assert.ok(!safeJsonLd({ a: '</script>' }).includes('<'));
  assert.equal(ageLabel({ minAge: null }), 'Rating not confirmed');
  assert.equal(ageLabel({ minAge: 6 }), 'All ages');
  assert.equal(ageLabel({ minAge: 16 }), '16+');
});
