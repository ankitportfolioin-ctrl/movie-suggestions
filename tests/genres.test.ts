import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalGenre, canonicalGenres, expandGenres } from '../server/genres.js';

test('D-02: Sci-Fi aliases collapse to one canonical spelling', () => {
  assert.equal(canonicalGenre('Science Fiction'), 'Sci-Fi');
  assert.equal(canonicalGenre('sci fi'), 'Sci-Fi');
  assert.equal(canonicalGenre('  SCI-FI '), 'Sci-Fi');
  assert.equal(canonicalGenre('Comedy'), 'Comedy');
});

test('canonicalGenres de-duplicates aliases in one list', () => {
  assert.deepEqual(canonicalGenres(['Science Fiction', 'Sci-Fi', 'Adventure']), ['Sci-Fi', 'Adventure']);
});

test('expandGenres lists every stored spelling the SQL filter must match', () => {
  assert.deepEqual(expandGenres(['Sci-Fi']), ['Sci-Fi', 'Science Fiction']);
  assert.deepEqual(expandGenres(['Comedy']), ['Comedy']);
  assert.deepEqual(expandGenres(['Sci-Fi', 'Comedy']), ['Sci-Fi', 'Science Fiction', 'Comedy']);
});
