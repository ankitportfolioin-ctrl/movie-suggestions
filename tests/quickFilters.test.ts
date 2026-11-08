import test from 'node:test';
import assert from 'node:assert/strict';
import { typesToLabel, labelToTypes, normalizeAudience, toggleGenre } from '../src/quickFilters.js';

test('type labels round-trip', () => {
  assert.equal(typesToLabel(['movie']), 'Movie');
  assert.equal(typesToLabel(['series']), 'Series');
  assert.equal(typesToLabel(['movie', 'series', 'short']), 'Any');
  assert.equal(typesToLabel(undefined), 'Movie');
  assert.deepEqual(labelToTypes('Series'), ['series']);
  assert.deepEqual(labelToTypes('Any').sort(), ['movie', 'series', 'short']);
  assert.deepEqual(labelToTypes('whatever'), ['movie']);
});

test('audience normalisation', () => {
  assert.equal(normalizeAudience('Family / kids'), 'Family with kids');
  assert.equal(normalizeAudience(undefined), 'Just me');
  assert.equal(normalizeAudience('Partner'), 'Partner');
});

test('genre toggle: add, remove, cap at 3, ignores "Surprise me"', () => {
  assert.deepEqual(toggleGenre(['Surprise me'], 'Comedy'), ['Comedy']);
  assert.deepEqual(toggleGenre(['Comedy'], 'Comedy'), []);
  assert.deepEqual(toggleGenre(['Comedy', 'Drama', 'Action'], 'Horror'), ['Drama', 'Action', 'Horror']);
});
