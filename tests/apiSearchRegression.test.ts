/**
 * Regression: 2026-10-15 production incident — the /api/search serverless
 * handler called parseUserQuery(text) with an undefined symbol and every
 * natural search on Vercel 500'd with "text is not defined". The handler now
 * shares the searchEngine pipeline and takes its query straight from the
 * request. These assertions keep any stale undefined-symbol call from
 * re-entering api/index.ts (a compile check alone wouldn't catch a same-file
 * accidental global).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('api/index.ts never calls parseUserQuery(text) with a stale symbol', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'api', 'index.ts'), 'utf8');
  assert.ok(!/parseUserQuery\s*\(\s*text\b/.test(src), 'stale parseUserQuery(text) call is back');
});

test('/api/search routes the raw request query through the shared pipeline', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'api', 'index.ts'), 'utf8');
  assert.ok(
    /runNaturalSearch\(\s*query\s*,/.test(src),
    'natural search must use the request `query` directly, not a parsed variable',
  );
});
