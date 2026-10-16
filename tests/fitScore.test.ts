import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fitScoreOf } from '../src/components/MovieCard.js';

describe('fit-score display contract', () => {
  test('card shows "Fit N/100", never a percent match', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/components/MovieCard.tsx'), 'utf8');
    assert.ok(src.includes('Fit {fitScore}/100'));
    assert.ok(!src.includes('% Match'));
    assert.ok(src.includes('Fit score ${fitScore} out of 100'));
    assert.ok(!src.toLowerCase().includes('percent match'));
  });

  test('saved old objects with matchScore still load', () => {
    assert.equal(fitScoreOf({ matchScore: 95 }), 95);
    assert.equal(fitScoreOf({ fitScore: 92, matchScore: 95 }), 92);
    assert.equal(fitScoreOf({}), 95);
  });
});
