import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecommendBody } from '../server/validate.js';

const good = {
  mood: 'Happy', genres: ['Comedy'], audience: 'Just me',
  maxRuntime: 'Any length', languages: ['Any'],
  preferences: {}, note: '', excludeIds: [],
};

test('accepts a valid body', () => {
  const r = validateRecommendBody(good);
  assert.equal(r.ok, true);
});

test('rejects bad mood / genre / audience / runtime / language', () => {
  assert.equal(validateRecommendBody({ ...good, mood: 'Hyped' }).ok, false);
  assert.equal(validateRecommendBody({ ...good, genres: 'Comedy' }).ok, false);
  assert.equal(validateRecommendBody({ ...good, genres: ['Western'] }).ok, false);
  assert.equal(validateRecommendBody({ ...good, audience: 'Crowd' }).ok, false);
  assert.equal(validateRecommendBody({ ...good, maxRuntime: 'Whenever' }).ok, false);
  assert.equal(validateRecommendBody({ ...good, languages: ['Klingon'] }).ok, false);
  assert.equal(validateRecommendBody(null).ok, false);
});

test('forces mature off for family, trims note, filters excludes', () => {
  const r = validateRecommendBody({
    ...good,
    audience: 'Family with kids',
    preferences: { mature: true },
    note: '  hi  '.padEnd(300, 'x'),
    excludeIds: [1, 'two', 3],
  });
  if (!r.ok) throw new Error('should validate');
  assert.equal(r.params.preferences.mature, false);
  assert.equal((r.params.note || '').length, 200);
  assert.deepEqual(r.params.excludeIds, [1, 3]);
  assert.deepEqual(r.params.genres, ['Comedy']);
});

test('caps genres at three', () => {
  const r = validateRecommendBody({ ...good, genres: ['Comedy', 'Drama', 'Action', 'Horror'] });
  if (!r.ok) throw new Error('should validate');
  assert.equal(r.params.genres.length, 3);
});

test('media types are case-insensitive and "any" expands to every kind', () => {
  const t = (types: unknown) => {
    const r = validateRecommendBody({ ...good, types });
    assert.equal(r.ok, true);
    return r.ok ? r.params.types : [];
  };
  assert.deepEqual(t(['Series']), ['series']);
  assert.deepEqual(t(['Movie']), ['movie']);
  assert.deepEqual(t(['Short film']), ['short']);
  assert.deepEqual([...t(['Any'])].sort(), ['movie', 'series', 'short']);
  assert.deepEqual(t(['bogus']), ['movie']);
  assert.deepEqual(t(undefined), ['movie']);
});
