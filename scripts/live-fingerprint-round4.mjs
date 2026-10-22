/**
 * Read-only deployment fingerprint (retest-3, 2026-10-22): does prod serve
 * 945a176's series pool + "Any length" fix? Direct API, minimal bodies.
 */
import { writeFileSync } from 'node:fs';
const BASE = 'https://movie-night-picker-one.vercel.app';
const out = [];

async function rec(label, body) {
  const r = await fetch(`${BASE}/api/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mood: 'Surprise me', genres: ['Surprise me'], audience: 'Just me',
      maxRuntime: 'Any length', languages: ['Any'], types: ['movie'],
      preferences: { highlyRated: false, hiddenGems: false, recent: false, classics: false, mature: false },
      note: '', excludeIds: [], taste: { weights: {}, eventCount: 0 }, referenceIds: [],
      ...body,
    }),
  });
  const j = await r.json();
  const movies = j.movies ?? [];
  out.push({ label, status: r.status, count: movies.length, notices: j.notices ?? [], titles: movies.slice(0, 10).map((m) => `${m.title}[${m.type ?? '?'}]${m.minAge != null ? ` age=${m.minAge}` : ' age=?'}`) });
}

await rec('series pool', { types: ['series'] });
await rec('any-length mind-bending', { mood: 'Mind-bending', note: 'surprise me, anything goes', types: ['movie'] });
await rec('any-length funny', { mood: 'Funny', note: 'surprise me, anything goes', types: ['movie'] });

writeFileSync('reports/live-evidence-2026-10-22-r3/deploy-fingerprint.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
