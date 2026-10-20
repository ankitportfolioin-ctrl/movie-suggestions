/**
 * D15 evidence: 30 NL searches against the local dev server on the real DB.
 * Records HTTP wall time per query straight from a real user path (the
 * /api/search endpoint the Natural Language tab calls).
 */
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const QUERIES = [
  'kannada movie', 'a family movie for my 6 year old', 'scary horror movie late night',
  'something like Interstellar', 'The Matrix', 'comedy for tired brain',
  'web series to binge', 'a war movie', 'no bollywood, only south indian movies',
  'old black and white classic', 'true story movie', 'a 90s movie with laughs',
  'korean mystery night', 'long movie over 150 minutes', 'tollywood action',
  'superhero movie', 'an action movie that is not a superhero movie', '90 minute movie comedy',
  'newest releases of 2026', 'marathi drama', 'sports underdog movie',
  'musical movie', 'something for grandparents', 'anime short watch',
  'animated family night', 'documentary about space', 'german thriller',
  'a mandarin action movie', 'nothing with Tom Cruise action', 'between 100 and 120 minutes drama',
];

const out = [];
for (const q of QUERIES) {
  const t0 = performance.now();
  let status = 0, n = 0;
  try {
    const res = await fetch(`${BASE}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });
    status = res.status;
    const body = await res.json();
    n = body.movies?.length ?? 0;
    const notices = (body.notices || []).join(' | ');
    out.push({ q: q, ms: Math.round(performance.now() - t0), status, picks: n, notices });
    console.log(`${String(Math.round(performance.now() - t0)).padStart(5)}ms ${status} picks=${n} "${q}"${notices ? ` NOTICES: ${notices}` : ''}`);
  } catch (e) {
    out.push({ q: q, ms: Math.round(performance.now() - t0), status: 0, error: String(e).slice(0, 80) });
    console.log(`ERROR "${q}": ${String(e).slice(0, 120)}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
fs.writeFileSync('reports/d15-timings-30.json', JSON.stringify(out, null, 2));
const ms = out.map((o) => o.ms).sort((a, b) => a - b);
console.log(`\nmedian=${ms[ms.length >> 1]}ms p90=${ms[Math.floor(ms.length * 0.9)]}ms max=${ms[ms.length - 1]}ms over8s=${ms.filter((x) => x > 8000).length}`);
