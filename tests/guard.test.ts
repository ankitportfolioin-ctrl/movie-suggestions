import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSameFilm } from '../server/omdb.js';

test('exact title match passes', () => {
  assert.equal(isSameFilm('Toy Story', 1995, { Title: 'Toy Story', Year: '1995' }), true);
});

test('punctuation variants pass (WALL·E vs WALL-E)', () => {
  assert.equal(isSameFilm('WALL·E', 2008, { Title: 'WALL-E', Year: '2008' }), true);
});

test('making-of documentary is rejected', () => {
  assert.equal(
    isSameFilm('(500) Days of Summer', 2009, { Title: 'Not a Love Story: Making (500) Days of Summer', Year: '2009' }),
    false
  );
});

test('wrong film with same year is rejected', () => {
  assert.equal(isSameFilm('Toy Story', 1995, { Title: 'Jumanji', Year: '1995' }), false);
});

test('year off by more than one is rejected', () => {
  assert.equal(isSameFilm('Dune', 2021, { Title: 'Dune', Year: '1984' }), false);
});

test('year off by one is tolerated (festival vs wide release)', () => {
  assert.equal(isSameFilm('Past Lives', 2023, { Title: 'Past Lives', Year: '2024' }), true);
});
