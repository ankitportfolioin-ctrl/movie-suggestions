import { test, expect, request } from '@playwright/test';
import { checkHardConstraints } from './hardcheck';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3101';

// 12 persona payloads (S1-S12 from C:\test-report\cinematch-test-report.md).
const PERSONAS: { id: string; params: any }[] = [
  { id: 'S1-tired-solo-90', params: { mood: 'Tired', genres: ['Surprise me'], audience: 'Just me', maxRuntime: 'Under 90 min', languages: ['Any'], preferences: {}, note: '', excludeIds: [] } },
  { id: 'S2-date-night', params: { mood: 'Romantic', genres: ['Romance', 'Comedy'], audience: 'Partner', maxRuntime: 'Under 2 hours', languages: ['English'], preferences: { highlyRated: true }, note: 'Loved Before Sunrise, no tragic endings', excludeIds: [] } },
  { id: 'S3-family-kids', params: { mood: 'Happy', genres: ['Family', 'Animation'], audience: 'Family with kids', maxRuntime: 'Under 2 hours', languages: ['Any'], preferences: {}, note: 'kids aged 6 and 9', excludeIds: [] } },
  { id: 'S4-friends-hindi-recent', params: { mood: 'Happy', genres: ['Surprise me'], audience: 'Friends', maxRuntime: 'Any length', languages: ['Hindi'], preferences: { recent: true }, note: '', excludeIds: [] } },
  { id: 'S5-stressed-mature', params: { mood: 'Stressed', genres: ['Thriller', 'Drama'], audience: 'Just me', maxRuntime: 'Any length', languages: ['Any'], preferences: { highlyRated: true, mature: true }, note: '', excludeIds: [] } },
  { id: 'S6-film-buff', params: { mood: 'Curious', genres: ['Sci-Fi', 'Mystery'], audience: 'Just me', maxRuntime: 'Under 2.5 hours', languages: ['English'], preferences: { highlyRated: true, hiddenGems: true }, note: 'Loved Arrival and Knives Out, no heavy gore', excludeIds: [] } },
  { id: 'S7-sad-korean', params: { mood: 'Sad', genres: ['Drama'], audience: 'Just me', maxRuntime: 'Any length', languages: ['Korean'], preferences: { highlyRated: true }, note: '', excludeIds: [] } },
  { id: 'S8-classics-partner', params: { mood: 'Relaxed', genres: ['Surprise me'], audience: 'Partner', maxRuntime: 'Under 2 hours', languages: ['English'], preferences: { classics: true }, note: '', excludeIds: [] } },
  { id: 'S9a-tamil-comedy', params: { mood: 'Happy', genres: ['Comedy'], audience: 'Friends', maxRuntime: 'Any length', languages: ['Tamil'], preferences: {}, note: '', excludeIds: [] } },
  { id: 'S9b-telugu-comedy-150m', params: { mood: 'Happy', genres: ['Comedy'], audience: 'Friends', maxRuntime: 'Under 2.5 hours', languages: ['Telugu'], preferences: {}, note: '', excludeIds: [] } },
  { id: 'S10-horror-friends', params: { mood: 'Adventurous', genres: ['Horror'], audience: 'Friends', maxRuntime: 'Under 2 hours', languages: ['Any'], preferences: { mature: true }, note: 'No found-footage', excludeIds: [] } },
  { id: 'S11-japanese-animation', params: { mood: 'Relaxed', genres: ['Animation', 'Fantasy'], audience: 'Just me', maxRuntime: 'Under 2 hours', languages: ['Japanese'], preferences: {}, note: '', excludeIds: [] } },
];

test('personas S1-S12: happy paths + E10 hard-constraint check', async () => {
  test.setTimeout(300_000);
  const ctx = await request.newContext({ baseURL: BASE });
  const allViolations: string[] = [];
  const summary: string[] = [];
  // S12 defaults
  const personas = [
    ...PERSONAS,
    { id: 'S12-defaults', params: { mood: 'Relaxed', genres: ['Surprise me'], audience: 'Just me', maxRuntime: 'Under 2 hours', languages: ['Any'], preferences: {}, note: '', excludeIds: [] } },
  ];
  for (const p of personas) {
    const t0 = Date.now();
    const res = await ctx.post('/api/recommend', { data: p.params });
    expect(res.status(), `${p.id} status`).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.movies), `${p.id} movies array`).toBeTruthy();
    const v = checkHardConstraints(p.id, p.params, body);
    allViolations.push(...v);
    summary.push(`${p.id}: n=${body.movies.length} notices=${(body.notices || []).length} violations=${v.length} ${Date.now() - t0}ms`);
  }
  console.log('PERSONAS:\n' + summary.join('\n'));
  console.log('VIOLATIONS:' + JSON.stringify(allViolations));
  expect(`violations: ${JSON.stringify(allViolations)}`).toBe('violations: []');
  await ctx.dispose();
});
