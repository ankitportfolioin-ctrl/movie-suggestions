import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('.env.example contains only placeholder credentials', () => {
  const text = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*[A-Z_]*KEY\s*=\s*"?([^"\s]+)"?\s*$/);
    if (m && m[1] !== '""' && m[1].length > 0) {
      assert.ok(
        /^(MY_|IN$|["']?$)/.test(m[1]) || m[1].length < 16,
        `suspicious credential in .env.example: ${line}`
      );
    }
  }
});

test('.env is gitignored (keys never committed)', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.ok(/^\.env\*/m.test(ignore));
});

test('client source never references server API keys', () => {
  const src = path.join(root, 'src');
  const stack = [src];
  const hits: string[] = [];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(tsx?|css)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        if (/OMDB_API_KEY|WATCHMODE_API_KEY|TMDB_API_KEY|GEMINI_API_KEY/.test(text)) hits.push(full);
      }
    }
  }
  assert.deepEqual(hits, []);
});
