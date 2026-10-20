/**
 * Legacy e2e bug list regressions (D01–D15) at unit level:
 * languages, genres, kid safety, year/runtime phrases, Bayesian rating,
 * honors the family gate for unknown ratings including War titles.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNote } from '../server/noteParser.js';
import { LANGUAGE_CODES, MOOD_GENRES } from '../server/omdb.js';
import { enforceHardConstraints } from '../server/gate.js';
import type { GateMovie, GateConstraints } from '../server/gate.js';

const gate = (over: Partial<GateConstraints> = {}): GateConstraints => ({
  maxMinutes: Infinity, maxRuntimeLabel: '', langCodes: [],
  highlyRated: false, recent: false, classics: false,
  audience: 'Just me', matureAllowed: false, types: ['movie'], seasonsMax: null,
  ...over,
});

test('language: kannada, mollywood, sandalwood parse to codes', () => {
  assert.ok(parseNote('kannada movie').languageHints.includes('Kannada'));
  assert.ok(parseNote('a Mollywood comedy').languageHints.includes('Malayalam'));
  assert.equal(LANGUAGE_CODES.Kannada, 'kn');
  assert.equal(LANGUAGE_CODES.Malayalam, 'ml');
});

test('language: no Bollywood keeps South Indian selectors only', () => {
  const s = parseNote('no bollywood, only south indian movies tonight');
  assert.deepEqual(s.languageHints, ['Tamil', 'Telugu', 'Malayalam', 'Kannada']);
  assert.ok(!s.languageHints.includes('Hindi'));
});

test('language: mandarin maps to Chinese (zh)', () => {
  const s = parseNote('a mandarin thriller');
  assert.ok(s.languageHints.includes('Chinese'));
  assert.equal(LANGUAGE_CODES.Chinese, 'zh');
});

test('D03: "6 year old"/"8 years old" never read as the classics era', () => {
  const a = parseNote('movie for my 6 year old');
  assert.ok(a.audienceSafe === true);
  assert.ok(a.eraHint === undefined, 'age mention must not set classics');
  const b = parseNote('my kid is 8 years old, something warm');
  assert.ok(b.eraHint === undefined);
  const c = parseNote('an old classic from my childhood');
  assert.equal(c.eraHint, 'classics');
});

test('D04: kids safety phrases switch on family mode', () => {
  for (const q of [
    'kids movie', 'a movie for my 6 year old', 'children cartoon',
    'toddler something', 'bachon ke liye movie', 'for my son a fun one',
    'movies for grandparents', 'teen sleepover picks', 'whole family movie night',
  ]) {
    assert.equal(parseNote(q).audienceSafe, true, q);
  }
});

test('D04: unknown-rating War titles are not family passes', () => {
  const war: GateMovie = {
    id: 1, title: 'War Movie', year: 2017, genres: ['War'],
    runtime: 90, rating: 8, language: 'en',
    isMature: false, certificate: '', minAge: null,
  };
  const fam = enforceHardConstraints([war], gate({ audience: 'Family with kids' }));
  assert.equal(fam.movies.length, 0, 'unknown rating + War genre must fail closed');
});

test('D05: no stated mood = Neutral with zero mood-genre bias', () => {
  assert.deepEqual(MOOD_GENRES.Neutral, []);
  assert.deepEqual(parseNote('just an awesome movie').moods, []);
});

test('D13: decades and phrasing', () => {
  const a = parseNote('a movie of the 90s with laughs');
  assert.equal(a.yearMin, 1990); assert.equal(a.yearMax, 1999);
  const b = parseNote('show me a 90s movie');
  assert.equal(b.yearMin, 1990); assert.equal(b.yearMax, 1999);
  const c = parseNote('some nineties madness');
  assert.equal(c.yearMin, 1990); assert.equal(c.yearMax, 1999);
  const d = parseNote('newest releases of 2026 please');
  assert.equal(d.yearMin, 2025);
  const e = parseNote('an old black and white classic');
  assert.equal(e.yearMax, 1969); assert.equal(e.eraHint, 'classics');
});

test('D13: runtime wording', () => {
  const a = parseNote('a movie longer than 150 minutes');
  assert.equal(a.runtimeMinMinutes, 150);
  const b = parseNote('look for between 100 and 120 minutes drama');
  assert.equal(b.runtimeMinMinutes, 100); assert.equal(b.runtimeMaxMinutes, 120);
  const c = parseNote('a 90 minute movie for relax time');
  assert.equal(c.runtimeMaxMinutes, 90);
  const d = parseNote('a 2 hour movie, nothing more');
  assert.equal(d.runtimeMaxMinutes, 120);
});
