import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { downloadExport } from '../scripts/ingest-tmdb.mjs';

// Test fixture: gzipped JSON lines with various edge cases
// - valid lines
// - one malformed line
// - one adult entry (should be dropped)
// - one video entry (should be dropped)
// - duplicate id
type FixtureLine = { id: number; popularity: number; adult: boolean; video: boolean; title: string } | string;
const FIXTURE_LINES: FixtureLine[] = [
  { id: 1, popularity: 100, adult: false, video: false, title: "Movie 1" },
  { id: 2, popularity: 200, adult: true, video: false, title: "Adult Movie" },      // dropped
  { id: 3, popularity: 300, adult: false, video: true, title: "Video Movie" },     // dropped
  { id: 4, popularity: 400, adult: false, video: false, title: "Movie 4" },
  "malformed json line",                                                             // malformed
  { id: 5, popularity: 500, adult: false, video: false, title: "Movie 5" },
  { id: 1, popularity: 150, adult: false, video: false, title: "Movie 1 Duplicate" }, // duplicate id
  { id: 6, popularity: 600, adult: false, video: false, title: "Movie 6" },
  { id: 7, popularity: 700, adult: false, video: false, title: "Movie 7" },
  { id: 8, popularity: 800, adult: false, video: false, title: "Movie 8" },
  { id: 9, popularity: 900, adult: false, video: false, title: "Movie 9" },
  { id: 10, popularity: 1000, adult: false, video: false, title: "Movie 10" },
];

function createGzippedFixture(lines: FixtureLine[]): string {
  const jsonLines = lines.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') + '\n';
  return jsonLines;
}

let server: Server;
let serverUrl: string;
let port: number;

before(async () => {
  port = 34567; // fixed port for test
  serverUrl = `http://localhost:${port}`;
  
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', serverUrl);
    const path = url.pathname;
    
    // Serve gzipped fixture at /p/exports/movie_ids_MM_DD_YYYY.json.gz
    const match = path.match(/^\/p\/exports\/movie_ids_(\d{2}_\d{2}_\d{4})\.json\.gz$/);
    if (match) {
      const dateStr = match[1];
      const today = new Date();
      const todayStr = `${String(today.getUTCMonth()+1).padStart(2,'0')}_${String(today.getUTCDate()).padStart(2,'0')}_${today.getUTCFullYear()}`;
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = `${String(yesterday.getUTCMonth()+1).padStart(2,'0')}_${String(yesterday.getUTCDate()).padStart(2,'0')}_${yesterday.getUTCFullYear()}`;
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
      const twoDaysAgoStr = `${String(twoDaysAgo.getUTCMonth()+1).padStart(2,'0')}_${String(twoDaysAgo.getUTCDate()).padStart(2,'0')}_${twoDaysAgo.getUTCFullYear()}`;
      
      // Simulate: today=404, yesterday=200, older=404
      if (dateStr === todayStr) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      if (dateStr === yesterdayStr) {
        const gzip = createGzip();
        res.writeHead(200, { 'Content-Type': 'application/gzip' });
        await pipeline(Readable.from(createGzippedFixture(FIXTURE_LINES)), gzip, res);
        return;
      }
      // Other dates return 404
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    
    // For 3-failure test: all dates return 404
    if (path === '/p/exports/fail_all_dates.json.gz') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    
    res.writeHead(404);
    res.end('Not Found');
  });
  
  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve());
    server.on('error', reject);
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

describe('downloadExport integration', () => {
  test('downloads and parses gzipped export, handles adult/video/malformed/duplicates', async () => {
    const { stream, dateStr } = await downloadExport('movie_ids', serverUrl);
    
    const { createGunzip } = await import('node:zlib');
    const { createInterface } = await import('node:readline');
    
    const gunzip = createGunzip();
    const rl = createInterface({ input: stream.pipe(gunzip), crlfDelay: Infinity });
    
    let totalLines = 0;
    let adultVideoDropped = 0;
    let malformed = 0;
    const seenIds = new Set<number>();
    const candidates: { id: number; popularity: number; obj: Record<string, unknown> }[] = [];
    const K = 3; // memory-safety: keep only top 3 by popularity
    
    for await (const line of rl) {
      totalLines++;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        malformed++;
        continue;
      }
      
      if (obj.adult === true || obj.video === true) {
        adultVideoDropped++;
        continue;
      }
      
      const id = obj.id as number;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      
      const popularity = (obj.popularity as number) || 0;
      if (candidates.length < K) {
        candidates.push({ id, popularity, obj });
        candidates.sort((a, b) => a.popularity - b.popularity);
      } else if (popularity > candidates[0].popularity) {
        candidates[0] = { id, popularity, obj };
        candidates.sort((a, b) => a.popularity - b.popularity);
      }
    }
    
    candidates.sort((a, b) => b.popularity - a.popularity);
    
    // Assertions
    assert.equal(totalLines, FIXTURE_LINES.length); // all lines read
    assert.equal(adultVideoDropped, 2); // adult + video
    assert.equal(malformed, 1); // malformed line
    assert.equal(seenIds.size, 8); // 10 valid objects - 2 dropped - 1 duplicate = 8 unique
    assert.equal(candidates.length, K); // memory-safety: never more than K in heap
    assert.equal(candidates[0].id, 10); // highest popularity
    assert.equal(candidates[1].id, 9);
    assert.equal(candidates[2].id, 8);
  });
  
  test('falls back to previous day when today returns 404', async () => {
    const { stream, dateStr } = await downloadExport('movie_ids', serverUrl);
    
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const expectedDate = `${String(yesterday.getUTCMonth()+1).padStart(2,'0')}_${String(yesterday.getUTCDate()).padStart(2,'0')}_${yesterday.getUTCFullYear()}`;
    
    assert.equal(dateStr, expectedDate);
    assert.ok(stream);
    
    // Verify stream is readable
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.ok(chunks.length > 0);
  });
  
  test('throws after 3 failed attempts (all dates 404)', async () => {
    await assert.rejects(
      downloadExport('fail_all_dates', serverUrl),
      /failed to download/
    );
  });
});

describe('memory safety: heap never exceeds K entries', () => {
  test('K=3 on 20 lines keeps only top 3', async () => {
    const manyLines = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      popularity: (i + 1) * 10,
      adult: false,
      video: false
    }));
    
    // Properly gzip the fixture
    const jsonLines = manyLines.map(l => JSON.stringify(l)).join('\n') + '\n';
    const gzipped = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gzip = createGzip();
      gzip.on('data', (c: Buffer) => chunks.push(c));
      gzip.on('end', () => resolve(Buffer.concat(chunks)));
      gzip.on('error', reject);
      gzip.write(jsonLines);
      gzip.end();
    });
    
    const { createInterface } = await import('node:readline');
    
    const gunzip = createGunzip();
    const rl = createInterface({ 
      input: Readable.from([gzipped]).pipe(gunzip), 
      crlfDelay: Infinity 
    });
    
    const K = 3;
    const candidates: { id: number; popularity: number; obj: Record<string, unknown> }[] = [];
    let maxHeapSize = 0;
    
    for await (const line of rl) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const popularity = (obj.popularity as number) || 0;
      
      if (candidates.length < K) {
        candidates.push({ id: obj.id as number, popularity, obj });
        candidates.sort((a, b) => a.popularity - b.popularity);
      } else if (popularity > candidates[0].popularity) {
        candidates[0] = { id: obj.id as number, popularity, obj };
        candidates.sort((a, b) => a.popularity - b.popularity);
      }
      
      maxHeapSize = Math.max(maxHeapSize, candidates.length);
    }
    
    candidates.sort((a, b) => b.popularity - a.popularity);
    
    assert.equal(maxHeapSize, K); // heap never exceeded K
    assert.equal(candidates.length, K);
    assert.equal(candidates[0].id, 20); // top 3: 20, 19, 18
    assert.equal(candidates[1].id, 19);
    assert.equal(candidates[2].id, 18);
  });
});