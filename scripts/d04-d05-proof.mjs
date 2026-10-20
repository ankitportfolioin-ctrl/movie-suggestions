/** Live proof for D04 (kid query) and D05 (first-two-genre rule).
 *  Plain .mjs: no TS annotations (server.ts endpoint). */
const BASE = 'http://localhost:3000';
const CASES = [
  'movie for my 6 year old',
  'horror movie', 'crime movie', 'science fiction movie', 'mystery movie',
];
for (const q of CASES) {
  const res = await fetch(`${BASE}/api/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const body = await res.json();
  if (body.error) { console.log(`"${q}" -> ERROR ${body.error}`); continue; }
  console.log(`\n"${q}" -> ${(body.movies || []).map((m) => `${m.title} [${m.genres.slice(0, 3).join(', ')}] minAge=${m.minAge}`).join(' | ')}`);
  if (body.notices?.length) console.log(`  notices: ${body.notices.join(' | ')}`);
}
