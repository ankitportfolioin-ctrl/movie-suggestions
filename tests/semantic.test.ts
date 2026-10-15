/**
 * Regression tests for the semantic search module.
 * These run without the Python model: they verify gating, fallback, and
 * merge behavior. Full encoding is covered manually (hostile inputs) and
 * stays out of CI to avoid model downloads and flaky subprocess timing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSemantic, mergeSemanticCandidates } from '../server/semantic.js';
import { refreshEmbeddingsCache } from '../server/embeddings.js';

test('searchSemantic returns [] when SEMANTIC_ENABLED is not true', async () => {
  const prev = process.env.SEMANTIC_ENABLED;
  delete process.env.SEMANTIC_ENABLED;
  try {
    const out = await searchSemantic('a comforting comedy', [{ id: 1, title: 'Toy Story', year: 1995, genres: ['Animation'] }], 5);
    assert.deepStrictEqual(out, []);
  } finally {
    if (prev === undefined) delete process.env.SEMANTIC_ENABLED;
    else process.env.SEMANTIC_ENABLED = prev;
  }
});

test('mergeSemanticCandidates dedupes by id and preserves pool order', () => {
  const pool = [
    { id: 1, title: 'Toy Story' },
    { id: 2, title: 'Coherence' },
  ];
  const semantic = [
    { id: 2, title: 'Coherence', similarity: 0.9 },
    { id: 3, title: 'The Fall', similarity: 0.8 },
  ];
  const merged = mergeSemanticCandidates(pool, semantic);
  assert.strictEqual(merged.length, 3);
  assert.deepStrictEqual(merged.map((m) => m.id), [1, 2, 3]);
});

test('mergeSemanticCandidates with empty semantic list returns pool copy', () => {
  const pool = [{ id: 1, title: 'Toy Story' }];
  const merged = mergeSemanticCandidates(pool, []);
  assert.deepStrictEqual(merged, pool);
  assert.notStrictEqual(merged, pool);
});

test('refreshEmbeddingsCache returns an array (empty when file missing/unreadable)', async () => {
  const movies = await refreshEmbeddingsCache();
  assert.ok(Array.isArray(movies));
});
