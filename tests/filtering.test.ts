import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidateMovies } from '../server/omdb.js';
import { baseParams, titles } from './params.js';

const MATURE_IDS = new Set([246741, 11423, 77]); // WWDITS, Memories of Murder, Memento

function ids(items: { movie: { id: number } }[]): number[] {
  return items.map((i) => i.movie.id);
}

test('family mode never returns mature or horror/crime/thriller', () => {
  const { items } = selectCandidateMovies(
    baseParams({ audience: 'Family with kids', genres: ['Horror'], maxRuntime: 'Any length' })
  );
  assert.ok(items.length > 0);
  for (const { movie } of items) {
    assert.ok(!MATURE_IDS.has(movie.id), `${movie.title} is mature`);
    assert.ok(!movie.genres.some((g) => ['Horror', 'Crime', 'Thriller'].includes(g)));
  }
});

test('non-family without opt-in excludes mature titles', () => {
  const { items } = selectCandidateMovies(
    baseParams({ genres: ['Horror'], audience: 'Friends', maxRuntime: 'Any length' })
  );
  for (const { movie } of items) {
    assert.ok(!MATURE_IDS.has(movie.id), `${movie.title} leaked without opt-in`);
  }
});

test('mature opt-in allows mature titles', () => {
  const { items } = selectCandidateMovies(
    baseParams({ genres: ['Horror'], audience: 'Friends', maxRuntime: 'Any length', preferences: { mature: true } })
  );
  assert.ok(titles(items).includes('What We Do in the Shadows'));
});

test('language is a hard filter', () => {
  const { items } = selectCandidateMovies(
    baseParams({ genres: ['Mystery'], languages: ['Korean'], maxRuntime: 'Any length' })
  );
  assert.ok(items.length > 0);
  for (const { movie } of items) assert.equal(movie.language, 'ko');
});

test('runtime is a hard filter on first pass', () => {
  const { items } = selectCandidateMovies(
    baseParams({ genres: ['Comedy'], maxRuntime: 'Under 90 min' })
  );
  for (const { movie } of items) assert.ok(movie.runtime <= 90, `${movie.title} is ${movie.runtime}m`);
});

test('note exclusions ban genres', () => {
  const { items, notices } = selectCandidateMovies(
    baseParams({ genres: ['Comedy'], note: 'no scary stuff please' })
  );
  assert.ok(!titles(items).includes('What We Do in the Shadows'));
  assert.ok(notices.some((n) => n.includes('Horror')));
});

test('hated titles are excluded with a notice', () => {
  const { items, notices } = selectCandidateMovies(
    baseParams({ genres: ['Animation'], note: 'hated Toy Story' })
  );
  assert.ok(!titles(items).includes('Toy Story'));
  assert.ok(notices.some((n) => n.includes('Toy Story')));
});

test('impossible filters return honest partial + notices, never mature leaks', () => {
  const { items, notices } = selectCandidateMovies(
    baseParams({ mood: 'Curious', genres: ['Mystery'], languages: ['Korean'], maxRuntime: 'Under 90 min', preferences: { highlyRated: true } })
  );
  assert.ok(items.length < 3);
  assert.ok(notices.length >= 1);
  for (const { movie } of items) assert.ok(!MATURE_IDS.has(movie.id));
});

test('relaxed runtime never produces false "fits" claims downstream', async () => {
  const { getRecommendationsWithOMDb } = await import('../server/omdb.js');
  const { movies } = await getRecommendationsWithOMDb(
    baseParams({ mood: 'Curious', genres: ['Mystery'], languages: ['Korean'], maxRuntime: 'Under 90 min', preferences: { highlyRated: true } })
  );
  for (const m of movies) {
    assert.ok(!m.reason.includes('under 90 min'), `false claim in: ${m.reason}`);
  }
});

test('no-close-match returns empty with guidance', () => {
  const { items, notices } = selectCandidateMovies(
    baseParams({ languages: ['Spanish'], genres: ['Documentary'] })
  );
  assert.equal(items.length, 0);
  assert.ok(notices.join(' ').includes('No close matches'));
});

test('excludeIds are respected until the ladder must relax them', () => {
  const all = [807, 10315, 862, 1104];
  const { items, notices } = selectCandidateMovies(
    baseParams({ mood: 'Tired', genres: ['Comedy'], maxRuntime: 'Under 90 min', excludeIds: all })
  );
  const got = ids(items);
  const overlap = got.filter((id) => all.includes(id));
  // Either fresh titles or an explicit notice about re-including seen ones
  assert.ok(overlap.length === 0 || notices.some((n) => n.includes('already seen')));
});
