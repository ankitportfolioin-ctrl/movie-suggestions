/**
 * Tests for the query parser (deterministic fallback and validation).
 * LLM path is tested via integration; here we test the deterministic
 * parser logic and validation directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUserQuery } from '../server/queryParser.js';
import { ParsedPreferences, validatePreferences, ResolvedTitle } from '../server/preferences.js';
import { resolveTitle } from '../server/queryParser.js';

function assertValidPrefs(prefs: ParsedPreferences) {
  // All arrays should be arrays
  assert.ok(Array.isArray(prefs.mood));
  assert.ok(Array.isArray(prefs.genres));
  assert.ok(Array.isArray(prefs.likedTitles));
  assert.ok(Array.isArray(prefs.dislikedTitles));
  assert.ok(Array.isArray(prefs.excludeGenres));
  assert.ok(Array.isArray(prefs.excludeContent));
  // Enums should be valid
  for (const m of prefs.mood) assert.ok(['tired','low_effort','easy_watch','intense','adrenaline','edge_of_seat','comforting','feel_good','relaxed','happy','stressed','romantic','adventurous','curious','sad'].includes(m));
  for (const g of prefs.genres) assert.ok(['Action','Adventure','Animation','Comedy','Crime','Documentary','Drama','Family','Fantasy','Horror','Mystery','Romance','Sci-Fi','Thriller','Western','War','Music','History'].includes(g));
  if (prefs.language) assert.ok(['English','Hindi','Tamil','Telugu','Korean','Japanese','Spanish','French','German','Italian','Portuguese','Chinese','Other'].includes(prefs.language));
  if (prefs.releasePeriod) assert.ok(['classic','80s','90s','2000s','2010s','recent','new'].includes(prefs.releasePeriod));
  if (prefs.intensity) assert.ok(['none','low','medium','high'].includes(prefs.intensity));
  if (prefs.watchEffort) assert.ok(['low','medium','high'].includes(prefs.watchEffort));
  assert.ok(typeof prefs.clarificationNeeded === 'boolean');
  assert.ok(typeof prefs.originalQuery === 'string');
}

test('parseUserQuery: basic tired + action + liked title', async () => {
  const prefs = await parseUserQuery("I'm tired, want an action movie, and I like The Godfather");
  assertValidPrefs(prefs);
  assert.ok(prefs.mood.includes('tired') || prefs.mood.includes('low_effort'));
  assert.ok(prefs.genres.includes('Action'));
  assert.ok(prefs.likedTitles.some(t => t.title.toLowerCase().includes('godfather')));
  assert.ok(prefs.mediaType === 'movie');
});

test('parseUserQuery: tv show query', async () => {
  const prefs = await parseUserQuery("show me something like Breaking Bad");
  assertValidPrefs(prefs);
  assert.ok(prefs.mediaType === 'tv');
  assert.ok(prefs.likedTitles.some(t => t.title.toLowerCase().includes('breaking bad')));
  assert.ok(prefs.genres.includes('Crime') || prefs.genres.includes('Drama') || prefs.genres.includes('Thriller'));
});

test('parseUserQuery: exclusion and unverifiable content', async () => {
  const prefs = await parseUserQuery("no horror, no gore, no jump scares");
  assertValidPrefs(prefs);
  assert.ok(prefs.excludeGenres.includes('Horror'));
  assert.ok(prefs.excludeContent.includes('gore') || prefs.excludeContent.includes('jump scares'));
});

test('parseUserQuery: runtime constraint', async () => {
  const prefs = await parseUserQuery("something short under 90 minutes");
  assertValidPrefs(prefs);
  assert.ok(prefs.maxRuntimeMinutes !== null && prefs.maxRuntimeMinutes <= 100);
});

test('parseUserQuery: language hint', async () => {
  const prefs = await parseUserQuery("a korean movie please");
  assertValidPrefs(prefs);
  assert.ok(prefs.language === 'Korean');
});

test('parseUserQuery: era hint', async () => {
  const prefs = await parseUserQuery("a classic 90s action movie");
  assertValidPrefs(prefs);
  assert.ok(prefs.releasePeriod === '90s' || prefs.releasePeriod === 'classic');
  assert.ok(prefs.genres.includes('Action'));
});

test('parseUserQuery: intensity preference', async () => {
  const prefs = await parseUserQuery("intense action, high adrenaline");
  assertValidPrefs(prefs);
  assert.ok(prefs.intensity === 'high');
  assert.ok(prefs.mood.some(m => ['intense','adrenaline','edge_of_seat'].includes(m)));
});

test('parseUserQuery: watch effort low', async () => {
  const prefs = await parseUserQuery("easy watch, don't want to think too hard");
  assertValidPrefs(prefs);
  assert.ok(prefs.watchEffort === 'low');
  assert.ok(prefs.mood.some(m => ['easy_watch','low_effort'].includes(m)));
});

test('parseUserQuery: conflicting tired + intense -> clarification', async () => {
  const prefs = await parseUserQuery("tired but want intense action");
  assertValidPrefs(prefs);
  assert.ok(prefs.clarificationNeeded === true);
  assert.ok(prefs.clarificationQuestion !== null);
  assert.ok(prefs.clarificationQuestion!.includes('tired'));
});

test('parseUserQuery: comforting + horror conflict -> clarification', async () => {
  const prefs = await parseUserQuery("want something comforting but also horror");
  assertValidPrefs(prefs);
  assert.ok(prefs.clarificationNeeded === true);
});

test('parseUserQuery: structured inputs take precedence', async () => {
  const prefs = await parseUserQuery("I want horror", {
    mood: ['tired'],
    genres: ['Comedy'],
    maxRuntimeMinutes: 90,
  });
  assertValidPrefs(prefs);
  // Structured mood overrides parsed mood
  assert.ok(prefs.mood.includes('tired'));
  assert.ok(!prefs.mood.some(m => ['intense','adrenaline'].includes(m)));
  // Structured genres override parsed genres
  assert.ok(prefs.genres.includes('Comedy'));
  assert.ok(!prefs.genres.includes('Horror'));
  // Structured runtime overrides
  assert.ok(prefs.maxRuntimeMinutes === 90);
});

test('validatePreferences: drops unknown enum values', () => {
  const raw = {
    mediaType: 'movie',
    mood: ['tired', 'invalid_mood'],
    genres: ['Action', 'InvalidGenre'],
    likedTitles: [],
    dislikedTitles: [],
    mustInclude: [],
    excludeGenres: ['Horror', 'InvalidGenre'],
    excludeContent: ['gore'],
    language: 'InvalidLang',
    region: 'US',
    maxRuntimeMinutes: 120,
    releasePeriod: 'invalid_era',
    intensity: 'invalid_intensity',
    watchEffort: 'invalid_effort',
    clarificationNeeded: false,
    clarificationQuestion: null,
    originalQuery: 'test',
  } as any;
  const validated = validatePreferences(raw);
  assert.ok(!validated.mood.includes('invalid_mood' as any));
  assert.ok(!validated.genres.includes('InvalidGenre' as any));
  assert.ok(!validated.excludeGenres.includes('InvalidGenre' as any));
  assert.ok(validated.language === null);
  assert.ok(validated.releasePeriod === null);
  assert.ok(validated.intensity === null);
  assert.ok(validated.watchEffort === null);
});

test('validatePreferences: handles null/undefined input', () => {
  const validated = validatePreferences(null);
  assert.ok(validated.mediaType === 'movie');
  assert.ok(validated.mood.length === 0);
  assert.ok(validated.genres.length === 0);
  assert.ok(validated.originalQuery === '');
});

test('validatePreferences: clamps runtime to positive', () => {
  const raw = { ...validatedBase(), maxRuntimeMinutes: -5 };
  const validated = validatePreferences(raw);
  assert.ok(validated.maxRuntimeMinutes === null);
});

test('validatePreferences: validates region format', () => {
  const raw = { ...validatedBase(), region: 'USA' };
  const validated = validatePreferences(raw);
  assert.ok(validated.region === null); // Not 2 chars

  const raw2 = { ...validatedBase(), region: 'US' };
  const validated2 = validatePreferences(raw2);
  assert.ok(validated2.region === 'US');
});

function validatedBase() {
  return {
    mediaType: 'movie',
    mood: [],
    genres: [],
    likedTitles: [],
    dislikedTitles: [],
    mustInclude: [],
    excludeGenres: [],
    excludeContent: [],
    language: null,
    region: null,
    maxRuntimeMinutes: null,
    releasePeriod: null,
    intensity: null,
    watchEffort: null,
    clarificationNeeded: false,
    clarificationQuestion: null,
    originalQuery: '',
  };
}

test('parseUserQuery: multiple liked titles', async () => {
  const prefs = await parseUserQuery("like The Godfather and Goodfellas and Casino");
  assertValidPrefs(prefs);
  assert.ok(prefs.likedTitles.length >= 2);
  const titles = prefs.likedTitles.map(t => t.title.toLowerCase());
  assert.ok(titles.some(t => t.includes('godfather')));
  assert.ok(titles.some(t => t.includes('goodfellas') || t.includes('casino')));
});

test('parseUserQuery: comparative preferences', async () => {
  const prefs = await parseUserQuery("like Interstellar but shorter");
  assertValidPrefs(prefs);
  assert.ok(prefs.likedTitles.some(t => t.title.toLowerCase().includes('interstellar')));
  assert.ok(prefs.maxRuntimeMinutes !== null && prefs.maxRuntimeMinutes < 169); // Interstellar is 169min
});

test('parseUserQuery: empty query returns defaults', async () => {
  const prefs = await parseUserQuery("");
  assertValidPrefs(prefs);
  assert.ok(prefs.mood.length === 0);
  assert.ok(prefs.genres.length === 0);
});

test('parseUserQuery: disliked titles from "hate" language', async () => {
  const prefs = await parseUserQuery("I hate The Room and Birdemic");
  assertValidPrefs(prefs);
  assert.ok(prefs.dislikedTitles.length >= 1);
  const titles = prefs.dislikedTitles.map(t => t.title.toLowerCase());
  assert.ok(titles.some(t => t.includes('room') || t.includes('birdemic')));
});

test('parseUserQuery: negated horror preference excludes horror', async () => {
  const prefs = await parseUserQuery('no horror please');
  assertValidPrefs(prefs);
  assert.ok(prefs.excludeGenres.includes('Horror'), 'Horror should be in excludeGenres');
  assert.ok(!prefs.genres.includes('Horror'), 'Horror should NOT be in genres');
});

test('parseUserQuery: feel-good query maps feel_good mood', async () => {
  const prefs = await parseUserQuery('I want a feel-good movie');
  assertValidPrefs(prefs);
  assert.ok(prefs.mood.includes('feel_good') || prefs.mood.includes('happy'), 'feel-good should map to feel_good or happy mood');
});

test('parseUserQuery: The Fall title resolution', async () => {
  const resolved = await resolveTitle('The Fall');
  assert.ok(resolved !== null, 'The Fall should resolve');
  if (resolved) {
    assert.ok(resolved.title === 'The Fall' || resolved.title.toLowerCase().includes('fall'));
    assert.ok(typeof resolved.tmdbId === 'number');
  }
});

test('parseUserQuery: runtime constraint under 90 min', async () => {
  const prefs = await parseUserQuery('something short under 90 minutes');
  assertValidPrefs(prefs);
  assert.ok(prefs.maxRuntimeMinutes !== null && prefs.maxRuntimeMinutes <= 95);
});

test('parseUserQuery: negated horror in note', async () => {
  const prefs = await parseUserQuery('I want something fun, no horror though');
  assertValidPrefs(prefs);
  assert.ok(prefs.excludeGenres.includes('Horror'), 'Horror should be excluded even in mixed query');
});