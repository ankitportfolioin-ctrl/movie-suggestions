import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNote } from '../server/noteParser.js';

test('detects genres and synonyms', () => {
  const s = parseNote('I want a funny sci-fi space adventure');
  assert.deepEqual(s.genres.sort(), ['Adventure', 'Comedy', 'Sci-Fi']);
});

test('detects exclusions with negation prefixes', () => {
  const s = parseNote('no scary jump scares, nothing too gory please');
  assert.ok(s.excludeGenres.includes('Horror'));
  assert.ok(!s.genres.includes('Horror'));
});

test('"no romance" excludes Romance instead of requesting it', () => {
  const s = parseNote('anything but mushy romance, exclude romance entirely');
  assert.ok(s.excludeGenres.includes('Romance'));
  assert.ok(!s.genres.includes('Romance'));
});

test('"not a horror movie" excludes Horror (negation scope)', () => {
  const s = parseNote('emotional movie, not a horror movie');
  assert.ok(s.excludeGenres.includes('Horror'));
  assert.ok(!s.genres.includes('Horror'));
});

test('"no supernatural horror" excludes Horror across adjectives', () => {
  const s = parseNote('dark mystery, no supernatural horror');
  assert.ok(s.excludeGenres.includes('Horror'));
  assert.ok(!s.genres.includes('Horror'));
});

test('"without gore" is unverifiable, never a genre ban', () => {
  const s = parseNote('horror movie without excessive gore');
  assert.ok(s.genres.includes('Horror'));
  assert.ok(!s.excludeGenres.includes('Horror'));
  assert.ok(s.unverifiable.includes('gore'));
});

test('"not only funny but emotional" stays positive (contrastive guard)', () => {
  const s = parseNote('not only funny but emotional');
  assert.ok(s.genres.includes('Comedy'));
  assert.ok(!s.excludeGenres.includes('Comedy'));
});

test('explicit exclusion beats a positive mention of the same genre', () => {
  const s = parseNote('I usually love horror, but no horror tonight');
  assert.ok(s.excludeGenres.includes('Horror'));
  assert.ok(!s.genres.includes('Horror'));
});

test('plot-twist talk is flagged unverifiable, not faked', () => {
  const s = parseNote('a clever plot twist with a great ending');
  assert.ok(s.unverifiable.includes('plot twists'));
});

test('2e: shorter/longer comparatives become runtime hints', () => {
  assert.equal(parseNote('something like Interstellar but shorter').runtimeHint, 'short');
  assert.equal(parseNote('a longer epic saga').runtimeHint, 'long');
});

test('2c: found-footage and tragic endings are flagged unverifiable', () => {
  assert.ok(parseNote('No found-footage.').unverifiable.includes('found footage'));
  assert.ok(parseNote('no tragic endings').unverifiable.includes('tragic tone'));
  const s = parseNote('horror without found footage');
  assert.ok(s.genres.includes('Horror'));
  assert.ok(s.unverifiable.includes('found footage'));
});

test('detects moods', () => {
  const s = parseNote('rough day, need cozy and uplifting');
  assert.ok(s.moods.includes('Stressed'));
  assert.ok(s.moods.includes('Relaxed'));
  assert.ok(s.moods.includes('Happy'));
});

test('detects runtime and era hints', () => {
  assert.equal(parseNote('something short and quick').runtimeHint, 'short');
  assert.equal(parseNote('an epic long film').runtimeHint, 'long');
  assert.equal(parseNote('a recent modern release').eraHint, 'recent');
  assert.equal(parseNote('a golden age classic').eraHint, 'classics');
});

test('detects acclaimed-seeking', () => {
  assert.equal(parseNote('an oscar masterpiece, highly rated only').wantsHighlyRated, true);
});

test('captures loved titles (quoted and unquoted)', () => {
  const s = parseNote("Loved Past Lives and 'Knives Out'");
  assert.ok(s.lovedTitles.includes('pastlives'));
  assert.ok(s.lovedTitles.includes('knivesout'));
});

test('captures hated titles separately from loved', () => {
  const s = parseNote('Loved Soul but hated Cats');
  assert.ok(s.lovedTitles.includes('soul'));
  assert.ok(!s.lovedTitles.includes('cats'));
  assert.ok(s.hatedTitles.includes('cats'));
});

test('detects language hints', () => {
  assert.deepEqual(parseNote('a korean movie please').languageHints, ['Korean']);
  assert.deepEqual(parseNote('bollywood night').languageHints, ['Hindi']);
});

test('empty and garbage notes yield empty signals', () => {
  assert.deepEqual(parseNote(''), { genres: [], excludeGenres: [], unverifiable: [], moods: [], lovedTitles: [], hatedTitles: [], mentionedTitles: [], languageHints: [], excludedPeople: [], likedPeople: [], unsupportedGenres: [], referenceTitles: [], referenceTitleNames: [], themeKeywords: [], comparativePreferences: [] });
  assert.deepEqual(parseNote('... !!!').genres, []);
});

test('reference titles keep their as-typed spelling for disclosure', () => {
  const s = parseNote('like Arrival, but lighter');
  assert.deepEqual(s.referenceTitles, ['arrival']);
  assert.deepEqual(s.referenceTitleNames, ['Arrival']);
});

test('positive genre mention is not treated as exclusion', () => {
  const s = parseNote('I love horror movies');
  assert.ok(s.genres.includes('Horror'));
  assert.ok(!s.excludeGenres.includes('Horror'));
});

test('mixed note parses all signal types', () => {
  const s = parseNote("Loved 'Arrival', no horror, something short and acclaimed, korean or space?");
  assert.ok(s.lovedTitles.includes('arrival'));
  assert.ok(s.excludeGenres.includes('Horror'));
  assert.ok(!s.genres.includes('Horror'));
  assert.equal(s.runtimeHint, 'short');
  assert.equal(s.wantsHighlyRated, true);
  assert.ok(s.genres.includes('Sci-Fi'));
});

test('2b: "Nothing with Tom Cruise" excludes the actor', () => {
  const s = parseNote('Nothing with Tom Cruise');
  assert.deepEqual(s.excludedPeople, ['Tom Cruise']);
  assert.deepEqual(s.likedPeople, []);
});

test('2b: "movies starring Tom Hanks" is a disclosed preference', () => {
  const s = parseNote('movies starring Tom Hanks');
  assert.deepEqual(s.likedPeople, ['Tom Hanks']);
  assert.deepEqual(s.excludedPeople, []);
});

test('2b: single names are ignored as too noisy', () => {
  const s = parseNote('nothing with Tom, anything with Brad');
  assert.deepEqual(s.excludedPeople, []);
  assert.deepEqual(s.likedPeople, []);
});

test('2b: director patterns work both ways', () => {
  assert.deepEqual(parseNote('directed by Denis Villeneuve').likedPeople, ['Denis Villeneuve']);
  assert.deepEqual(parseNote('nothing directed by Michael Bay').excludedPeople, ['Michael Bay']);
});

test('hindi: halka-phulka comedy maps mood and genre', () => {
  const s = parseNote('kuch halka-phulka comedy dikhao');
  assert.ok(s.moods.includes('Relaxed'));
  assert.ok(s.genres.includes('Comedy'));
});

test('hindi: dukhi maps Sad, thaka maps Tired', () => {
  assert.ok(parseNote('bahut dukhi hoon').moods.includes('Sad'));
  assert.ok(parseNote('thaka hua hoon, easy movie').moods.includes('Tired'));
});

test('hindi: daravni maps Horror with negation scope', () => {
  const s = parseNote('no daravni film please');
  assert.ok(s.excludeGenres.includes('Horror'));
  assert.ok(!s.genres.includes('Horror'));
});

test('hindi: chhoti maps short runtime, purani maps classics', () => {
  assert.equal(parseNote('koi chhoti movie batao').runtimeHint, 'short');
  assert.equal(parseNote('koi purani classic film').eraHint, 'classics');
});

// STEP 2 regression: every genre phrase maps to a filterable genre.
for (const [phrase, genre] of [
  ['romantic', 'Romance'], ['romance', 'Romance'], ['rom-com', 'Romance'],
  ['science fiction', 'Sci-Fi'], ['sci-fi', 'Sci-Fi'], ['documentary', 'Documentary'],
  ['thriller', 'Thriller'], ['animated', 'Animation'],
  ['family', 'Family'], ['war', 'War'], ['musical', 'Music'],
  ['western', 'Western'], ['historical', 'History'], ['biopic', 'Biography'],
  ['true story', 'Biography'], ['sports', 'Sports'],
] as [string, string][]) {
  test(`genre phrase "${phrase}" -> ${genre}`, () => {
    const s = parseNote(`show me a ${phrase} movie`);
    assert.ok(s.genres.includes(genre), `${phrase}: got ${JSON.stringify(s.genres)}`);
  });
}

// D02/H09: "superhero" is not a filterable catalog tag — it is disclosed,
// never mapped to Action, and a negated mention must not exclude Action.
test('positive "superhero" discloses instead of mapping to Action', () => {
  const s = parseNote('show me a superhero movie');
  assert.deepEqual(s.genres, []);
  assert.ok(s.unsupportedGenres.includes('Superhero'));
});
test('"an action movie that is not a superhero movie" keeps Action', () => {
  const s = parseNote('an action movie that is not a superhero movie');
  assert.deepEqual(s.genres, ['Action']);
  assert.deepEqual(s.excludeGenres, []);
  assert.deepEqual(s.unsupportedGenres, []);
});

// STEP 2 regression: year phrases -> explicit yearMin/yearMax.
for (const [phrase, min, max] of [
  ['2023 or later', 2023, undefined], ['after 2015', 2016, undefined],
  ['before 1990', undefined, 1989], ['from the 80s', 1980, 1989], ['in 2019', 2019, 2019],
] as [string, number | undefined, number | undefined][]) {
  test(`year phrase "${phrase}"`, () => {
    const s = parseNote(`a good movie from ${phrase}`);
    assert.equal(s.yearMin, min);
    assert.equal(s.yearMax, max);
  });
}

// STEP 2 regression: runtime phrases -> explicit min/max minutes.
for (const [phrase, min, max] of [
  ['under 2 hours', undefined, 120], ['under 60 minutes', undefined, 60],
  ['2 ghante se kam', undefined, 120], ['longer than 150 minutes', 150, undefined],
  ['over 2 hours', 120, undefined],
] as [string, number | undefined, number | undefined][]) {
  test(`runtime phrase "${phrase}"`, () => {
    const s = parseNote(`a movie that is ${phrase}`);
    assert.equal(s.runtimeMinMinutes, min);
    assert.equal(s.runtimeMaxMinutes, max);
  });
}

test('"lambi" and bare "long" mean a minimum, never a maximum', () => {
  for (const q of ['koi lambi movie', 'a long epic movie']) {
    const s = parseNote(q);
    assert.equal(s.runtimeMinMinutes, 150);
    assert.equal(s.runtimeMaxMinutes, undefined);
  }
});

test('contradiction names both bounds', () => {
  const s = parseNote('a movie under 60 minutes and over 180 minutes');
  assert.equal(s.contradiction, 'No movie can be both under 60 minutes and over 180 minutes');
});

test('negation before genre extraction: horror excluded, comedy kept', () => {
  const s = parseNote("horror comedy, but I don't want horror");
  assert.deepEqual(s.genres, ['Comedy']);
  assert.deepEqual(s.excludeGenres, ['Horror']);
});
