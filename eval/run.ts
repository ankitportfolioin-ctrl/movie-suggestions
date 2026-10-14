#!/usr/bin/env tsx
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface GoldenQuery {
  id: string;
  name: string;
  payload: any;
  acceptable: string[];
}

interface Result {
  id: string;
  name: string;
  movies: Array<{ title: string; runtime: number; certificate?: string; language?: string; rating: number; year: number; mediaType?: string; actors?: string[]; director?: string }>;
  notices: string[];
  latencyMs: number;
  error?: string;
}

interface Metrics {
  precisionAt5: number;
  ndcgAt10: number;
  hardConstraintViolationRate: number;
  namedMovieRecommendedBackRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalQueries: number;
  successfulQueries: number;
  byQuery: Array<{
    id: string;
    precisionAt5: number;
    ndcgAt10: number;
    violations: string[];
    namedMovieReturned: string[];
    latencyMs: number;
  }>;
}

const BASE_URL = process.env.EVAL_BASE_URL || 'http://127.0.0.1:3000';
const ENDPOINT = `${BASE_URL}/api/recommend`;
const GOLDEN_PATH = join(__dirname, 'golden.json');
const BASELINE_PATH = join(__dirname, 'baseline.json');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30000;

function parseNoteForExclusions(note: string): { hatedTitles: string[]; excludedPeople: string[] } {
  const hatedTitles: string[] = [];
  const excludedPeople: string[] = [];
  
  const noteLower = note.toLowerCase();
  
  // Extract quoted titles with negation
  const quotedMatches = note.match(/['"]([^'"]{2,60})['"]/g) || [];
  for (const q of quotedMatches) {
    const at = note.indexOf(q);
    const inner = q.slice(1, -1).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (inner.length >= 3 && !['the', 'and', 'with'].includes(inner)) {
      const before = note.slice(Math.max(0, at - 48), at);
      const hasNegation = /\b(no|not|without|avoid|nothing|hate|dislike|skip|exclude|except|anything but|free of|light on)\b/i.test(before);
      if (hasNegation) hatedTitles.push(inner);
    }
  }
  
  // "hated/disliked X"
  const hatedMatch = note.match(/\b(?:hated?|disliked?|can't stand|despised?)\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/i);
  if (hatedMatch?.[1]) {
    const norm = hatedMatch[1].trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm.length >= 3) hatedTitles.push(norm);
  }
  
  // "nothing with X" or "no X"
  const personMatch = note.match(/\b(?:nothing with|no|without)\s+([A-Z][A-Za-z.'\\-]*(?:\s+[A-Z][A-Za-z.'\\-]*)+)/gi);
  if (personMatch) {
    for (const m of personMatch) {
      const name = m.replace(/^(nothing with|no|without)\s+/i, '').replace(/[.]+$/, '').trim();
      if (name.split(' ').length >= 2) excludedPeople.push(name);
    }
  }
  
  // "directed by X" with negation
  const dirMatch = note.match(/\b(?:no|without|nothing)\s+(?:directed by|a film by|from director)\s+([A-Z][A-Za-z.'\\-]*(?:\s+[A-Z][A-Za-z.'\\-]*)+)/gi);
  if (dirMatch) {
    for (const m of dirMatch) {
      const name = m.replace(/^(no|without|nothing)\s+(directed by|a film by|from director)\s+/i, '').replace(/[.]+$/, '').trim();
      if (name.split(' ').length >= 2) excludedPeople.push(name);
    }
  }
  
  return { hatedTitles, excludedPeople };
}

function checkHardConstraints(movie: Result['movies'][0], payload: any): string[] {
  const violations: string[] = [];
  
  // Runtime
  const capMap: Record<string, number> = {
    'Under 90 min': 90,
    'Under 2 hours': 120,
    'Under 2.5 hours': 150,
    'Any length': Infinity
  };
  const maxMinutes = capMap[payload.maxRuntime] || Infinity;
  if (maxMinutes !== Infinity && movie.runtime > maxMinutes) {
    violations.push(`runtime ${movie.runtime}m > ${maxMinutes}m cap`);
  }
  
  // Language
  if (payload.languages.length > 0 && !payload.languages.includes('Any')) {
    const codes: Record<string, string> = {
      English: 'en', Hindi: 'hi', Tamil: 'ta', Telugu: 'te',
      Korean: 'ko', Japanese: 'ja', Spanish: 'es', French: 'fr'
    };
    const targetCodes = payload.languages.map((l: string) => codes[l]).filter(Boolean);
    if (targetCodes.length > 0 && movie.language && !targetCodes.includes(movie.language)) {
      violations.push(`language ${movie.language} not in ${targetCodes.join(',')}`);
    }
  }
  
  // Rating
  if (payload.preferences?.highlyRated && movie.rating < 7.0) {
    violations.push(`rating ${movie.rating} < 7.0`);
  }
  
  // Year - Recent
  if (payload.preferences?.recent && movie.year < 2021) {
    violations.push(`year ${movie.year} < 2021 (recent)`);
  }
  
  // Year - Classics
  if (payload.preferences?.classics && movie.year >= 2000) {
    violations.push(`year ${movie.year} >= 2000 (classics)`);
  }
  
  // Maturity
  const isFamily = payload.audience === 'Family with kids';
  const matureAllowed = !isFamily && payload.preferences?.mature;
  const matureCerts = new Set(['R', 'NC-17', 'TV-MA', 'X', 'A', '18', '18+']);
  const familyCerts = new Set(['G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG', 'U']);
  
  const cert = (movie.certificate || '').trim().toUpperCase();
  if (isFamily) {
    if (!cert || !familyCerts.has(cert)) {
      violations.push(`family mode: cert '${cert || 'unknown'}' not in allowlist`);
    }
  } else if (!matureAllowed && cert && matureCerts.has(cert)) {
    violations.push(`mature OFF but cert is ${cert}`);
  }
  
  // Type
  if (movie.mediaType && movie.mediaType !== 'movie') {
    violations.push(`type is ${movie.mediaType}, not movie`);
  }
  
  return violations;
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function dcg(relevances: number[], k: number): number {
  let sum = 0;
  for (let i = 0; i < Math.min(k, relevances.length); i++) {
    sum += (Math.pow(2, relevances[i]) - 1) / Math.log2(i + 2);
  }
  return sum;
}

function ndcg(relevances: number[], k: number): number {
  const ideal = dcg([...relevances].sort((a, b) => b - a), k);
  if (ideal === 0) return 0;
  return dcg(relevances, k) / ideal;
}

async function runEvaluation(): Promise<Metrics> {
  console.log('📊 Loading golden queries...');
  const golden: GoldenQuery[] = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8'));
  console.log(`   Loaded ${golden.length} queries`);
  
  console.log(`🚀 Running evaluation against ${ENDPOINT}...`);
  const results: Result[] = [];
  const latencies: number[] = [];
  
  for (let i = 0; i < golden.length; i++) {
    const q = golden[i];
    let attempt = 0;
    let success = false;
    
    while (attempt <= MAX_RETRIES && !success) {
      const start = Date.now();
      
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(q.payload)
        });
        
        const latency = Date.now() - start;
        latencies.push(latency);
        
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          if (res.status === 429 && attempt < MAX_RETRIES) {
            attempt++;
            process.stdout.write(`  ⏳ ${q.id} rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY_MS/1000}s...\n`);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          results.push({ id: q.id, name: q.name, movies: [], notices: [], latencyMs: latency, error: `HTTP ${res.status}: ${errText}` });
          process.stdout.write(`  ✗ ${q.id} (${latency}ms) HTTP ${res.status}\n`);
          break;
        }
        
        const data = await res.json();
        
        // Check for rate limit error in response body
        if (data.error && data.error.includes('Too many requests')) {
          if (attempt < MAX_RETRIES) {
            attempt++;
            process.stdout.write(`  ⏳ ${q.id} rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY_MS/1000}s...\n`);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          results.push({ id: q.id, name: q.name, movies: [], notices: [], latencyMs: latency, error: data.error });
          process.stdout.write(`  ✗ ${q.id} (${latency}ms) RATE LIMITED\n`);
          break;
        }
        
        results.push({
          id: q.id,
          name: q.name,
          movies: data.movies || [],
          notices: data.notices || [],
          latencyMs: latency
        });
        
        process.stdout.write(`  ✓ ${q.id} (${latency}ms, ${data.movies?.length || 0} movies)\n`);
        success = true;
        
        // Delay to avoid rate limiting (30 req/10min = 1 per 20s)
        if (i < golden.length - 1) {
          await new Promise(r => setTimeout(r, 22000));
        }
      } catch (e: any) {
        const latency = Date.now() - start;
        latencies.push(latency);
        if (attempt < MAX_RETRIES) {
          attempt++;
          process.stdout.write(`  ⏳ ${q.id} error (attempt ${attempt}/${MAX_RETRIES}): ${e.message}\n`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        results.push({ id: q.id, name: q.name, movies: [], notices: [], latencyMs: latency, error: e.message });
        process.stdout.write(`  ✗ ${q.id} (${latency}ms) ERROR: ${e.message}\n`);
        break;
      }
    }
    
    if (!success) {
      process.stdout.write(`  ✗ ${q.id} FAILED after ${MAX_RETRIES} retries\n`);
    }
  }
  
  // Compute metrics
  console.log('\n📈 Computing metrics...');
  let totalPrecision5 = 0;
  let totalNdcg10 = 0;
  let totalViolations = 0;
  let totalNamedMovieReturns = 0;
  let queriesWithResults = 0;
  const byQuery = [];
  
  for (let i = 0; i < golden.length; i++) {
    const q = golden[i];
    const r = results[i];
    
    if (r.error || r.movies.length === 0) {
      byQuery.push({
        id: q.id,
        precisionAt5: 0,
        ndcgAt10: 0,
        violations: [],
        namedMovieReturned: [],
        latencyMs: r.latencyMs
      });
      continue;
    }
    
    queriesWithResults++;
    
    // Precision@5
    const top5 = r.movies.slice(0, 5);
    const acceptableSet = new Set(q.acceptable.map(normalizeTitle));
    let hits = 0;
    for (const m of top5) {
      if (acceptableSet.has(normalizeTitle(m.title))) hits++;
    }
    const precision5 = hits / Math.min(5, r.movies.length);
    totalPrecision5 += precision5;
    
    // nDCG@10
    const relevances = r.movies.slice(0, 10).map(m => acceptableSet.has(normalizeTitle(m.title)) ? 1 : 0);
    const ndcg10 = ndcg(relevances, 10);
    totalNdcg10 += ndcg10;
    
    // Hard constraint violations
    let violations: string[] = [];
    for (const m of r.movies) {
      const v = checkHardConstraints(m, q.payload);
      if (v.length > 0) {
        violations.push(`${m.title}: ${v.join('; ')}`);
        totalViolations++;
      }
    }
    
    // Named movie recommended back
    const { hatedTitles, excludedPeople } = parseNoteForExclusions(q.payload.note || '');
    let namedMovieReturns: string[] = [];
    for (const m of r.movies) {
      const normTitle = normalizeTitle(m.title);
      for (const hated of hatedTitles) {
        if (hated === normTitle || hated.includes(normTitle) || normTitle.includes(hated)) {
          namedMovieReturns.push(m.title);
          totalNamedMovieReturns++;
        }
      }
      // Check excluded people
      if (m.actors) {
        for (const person of excludedPeople) {
          const personLower = person.toLowerCase();
          if (m.actors.some(a => a.toLowerCase().includes(personLower))) {
            namedMovieReturns.push(m.title);
            totalNamedMovieReturns++;
          }
        }
      }
      if (m.director) {
        for (const person of excludedPeople) {
          const personLower = person.toLowerCase();
          if (m.director!.toLowerCase().includes(personLower)) {
            namedMovieReturns.push(m.title);
            totalNamedMovieReturns++;
          }
        }
      }
    }
    
    byQuery.push({
      id: q.id,
      precisionAt5: precision5,
      ndcgAt10: ndcg10,
      violations,
      namedMovieReturned: namedMovieReturns,
      latencyMs: r.latencyMs
    });
  }
  
  // Latency percentiles
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0;
  const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;
  
  const metrics: Metrics = {
    precisionAt5: queriesWithResults > 0 ? totalPrecision5 / queriesWithResults : 0,
    ndcgAt10: queriesWithResults > 0 ? totalNdcg10 / queriesWithResults : 0,
    hardConstraintViolationRate: queriesWithResults > 0 ? totalViolations / queriesWithResults : 0,
    namedMovieRecommendedBackRate: queriesWithResults > 0 ? totalNamedMovieReturns / queriesWithResults : 0,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    totalQueries: golden.length,
    successfulQueries: queriesWithResults,
    byQuery
  };
  
  // Save baseline
  writeFileSync(BASELINE_PATH, JSON.stringify(metrics, null, 2));
  console.log(`\n✅ Baseline saved to ${BASELINE_PATH}`);
  
  // Print summary
  console.log('\n📊 BASELINE METRICS:');
  console.log(`   Precision@5:     ${(metrics.precisionAt5 * 100).toFixed(1)}%`);
  console.log(`   nDCG@10:         ${(metrics.ndcgAt10 * 100).toFixed(1)}%`);
  console.log(`   Hard violations: ${metrics.hardConstraintViolationRate.toFixed(2)} per query`);
  console.log(`   Named back rate: ${metrics.namedMovieRecommendedBackRate.toFixed(2)} per query`);
  console.log(`   p50 latency:     ${metrics.p50LatencyMs}ms`);
  console.log(`   p95 latency:     ${metrics.p95LatencyMs}ms`);
  console.log(`   Successful:      ${metrics.successfulQueries}/${metrics.totalQueries}`);
  
  return metrics;
}

runEvaluation().catch(e => {
  console.error('❌ Evaluation failed:', e);
  process.exit(1);
});