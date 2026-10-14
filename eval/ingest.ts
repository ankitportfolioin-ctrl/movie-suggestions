#!/usr/bin/env tsx
/**
 * Resumable movie ingestion from TMDB + OMDb.
 * - Fetches popular/top-rated movies from TMDB
 * - Enriches with OMDb for certificates, cast, director
 * - Rate-limit aware with caching and resume capability
 * - Targets 5000+ movies
 */

import dotenv from 'dotenv';
dotenv.config();

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db, insertStmt, selectByImdb, countStmt } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CACHE_DIR = join(__dirname, '..', 'data', 'cache');
mkdirSync(CACHE_DIR, { recursive: true });

const TMDB_API_KEY = process.env.TMDB_API_KEY?.trim();
const OMDB_API_KEY = process.env.OMDB_API_KEY?.trim();
const TMDB_BASE = 'https://api.themoviedb.org/3';
const OMDB_BASE = 'https://www.omdbapi.com';

if (!TMDB_API_KEY) {
  console.error('❌ TMDB_API_KEY not set');
  process.exit(1);
}
if (!OMDB_API_KEY) {
  console.error('❌ OMDB_API_KEY not set');
  process.exit(1);
}

// Rate limiting
const TMDB_RATE_LIMIT = 40; // requests per 10 seconds
const TMDB_WINDOW_MS = 10_000;
const OMDB_RATE_LIMIT = 60; // requests per minute
const OMDB_WINDOW_MS = 60_000;

const tmdbTimestamps: number[] = [];
const omdbTimestamps: number[] = [];

async function waitForRateLimit(timestamps: number[], limit: number, windowMs: number) {
  const now = Date.now();
  const recent = timestamps.filter(t => now - t < windowMs);
  if (recent.length >= limit) {
    const oldest = recent[0];
    const waitMs = windowMs - (now - oldest) + 100;
    console.log(`  ⏳ Rate limit: waiting ${waitMs}ms...`);
    await new Promise(r => setTimeout(r, waitMs));
  }
  timestamps.push(Date.now());
}

// Cache helpers
function getCachePath(key: string): string {
  return join(CACHE_DIR, key.replace(/[^a-zA-Z0-9]/g, '_') + '.json');
}

async function fetchJson(url: string, cacheKey?: string, cacheTtlMs = 7 * 24 * 60 * 60 * 1000): Promise<any> {
  if (cacheKey) {
    const cachePath = getCachePath(cacheKey);
    if (existsSync(cachePath)) {
      const stat = readFileSync(cachePath, 'utf-8');
      try {
        const cached = JSON.parse(stat);
        if (Date.now() - cached.timestamp < cacheTtlMs) {
          return cached.data;
        }
      } catch {}
    }
  }

  await waitForRateLimit(
    url.includes('omdbapi') ? omdbTimestamps : tmdbTimestamps,
    url.includes('omdbapi') ? OMDB_RATE_LIMIT : TMDB_RATE_LIMIT,
    url.includes('omdbapi') ? OMDB_WINDOW_MS : TMDB_WINDOW_MS
  );

  const res = await fetch(url, { headers: { 'User-Agent': 'MovieNightPicker/1.0' } });
  if (!res.ok) {
    if (res.status === 429) {
      console.log(`  ⚠️  Rate limited (429), waiting 30s...`);
      await new Promise(r => setTimeout(r, 30_000));
      return fetchJson(url, cacheKey, cacheTtlMs);
    }
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();

  if (cacheKey) {
    const cachePath = getCachePath(cacheKey);
    writeFileSync(cachePath, JSON.stringify({ timestamp: Date.now(), data }));
  }

  return data;
}

// Tone scoring from genres/keywords (simplified heuristic)
function computeToneScores(genres: string[], keywords: string[]): Record<string, number> {
  const genreLower = genres.map(g => g.toLowerCase());
  const keywordLower = keywords.map(k => k.toLowerCase());
  const allText = [...genreLower, ...keywordLower].join(' ');

  const scores = {
    energy: 0.5,
    darkness: 0.5,
    humor: 0.5,
    emotional_weight: 0.5,
    complexity: 0.5,
  };

  // Energy: action, adventure, thriller
  if (genreLower.some(g => ['action', 'adventure', 'thriller', 'war', 'western'].includes(g))) scores.energy += 0.2;
  if (keywordLower.some(k => ['chase', 'fight', 'explosion', 'battle'].includes(k))) scores.energy += 0.1;

  // Darkness: horror, crime, noir, thriller
  if (genreLower.some(g => ['horror', 'crime', 'thriller', 'noir'].includes(g))) scores.darkness += 0.2;
  if (keywordLower.some(k => ['murder', 'serial killer', 'dark', 'gritty', 'violent'].includes(k))) scores.darkness += 0.15;

  // Humor: comedy
  if (genreLower.some(g => ['comedy'].includes(g))) scores.humor += 0.3;
  if (keywordLower.some(k => ['funny', 'humor', 'satire', 'parody'].includes(k))) scores.humor += 0.1;

  // Emotional weight: drama, romance, tragedy
  if (genreLower.some(g => ['drama', 'romance'].includes(g))) scores.emotional_weight += 0.2;
  if (keywordLower.some(k => ['tearjerker', 'sad', 'emotional', 'heartbreaking', 'loss'].includes(k))) scores.emotional_weight += 0.15;

  // Complexity: mystery, sci-fi, thriller, non-linear
  if (genreLower.some(g => ['mystery', 'sci-fi', 'thriller'].includes(g))) scores.complexity += 0.15;
  if (keywordLower.some(k => ['time travel', 'mind-bending', 'non-linear', 'puzzle', 'twist'].includes(k))) scores.complexity += 0.2;

  // Clamp
  Object.keys(scores).forEach(k => {
    scores[k as keyof typeof scores] = Math.max(0, Math.min(1, scores[k as keyof typeof scores]));
  });

  return scores;
}

async function getTmdbMovieDetails(tmdbId: number): Promise<any> {
  const url = `${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=keywords,credits`;
  return fetchJson(url, `tmdb_details_${tmdbId}`);
}

async function getOmdbByImdb(imdbId: string): Promise<any> {
  const url = `${OMDB_BASE}/?apikey=${OMDB_API_KEY}&i=${imdbId}&plot=full`;
  return fetchJson(url, `omdb_${imdbId}`);
}

async function getOmdbByTitle(title: string, year: number): Promise<any> {
  const url = `${OMDB_BASE}/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(title)}&y=${year}&plot=full`;
  return fetchJson(url, `omdb_${title}_${year}`);
}

async function discoverMovies(sortBy: string, pages: number): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1; page <= pages; page++) {
    const url = `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&sort_by=${sortBy}&vote_count.gte=100&page=${page}&include_adult=false`;
    const data = await fetchJson(url, `tmdb_discover_${sortBy}_p${page}`);
    if (data.results) {
      for (const m of data.results) {
        if (m.id && m.poster_path) ids.push(m.id);
      }
    }
    console.log(`  Discovered ${ids.length} movies from ${sortBy} page ${page}`);
  }
  return ids;
}

async function ingestMovie(tmdbId: number): Promise<boolean> {
  try {
    // Get TMDB details
    const tmdb = await getTmdbMovieDetails(tmdbId);
    if (!tmdb || tmdb.adult === true) return false;

    const imdbId = tmdb.imdb_id;
    if (!imdbId) return false;

    // Check if already exists
    const existing = selectByImdb.get(imdbId);
    if (existing) {
      // Update if needed
      return false;
    }

    // Get OMDb data for certificate, cast, director
    let omdb = null;
    try {
      omdb = await getOmdbByImdb(imdbId);
    } catch (e) {
      // Try title+year fallback
      try {
        omdb = await getOmdbByTitle(tmdb.title, tmdb.release_date ? parseInt(tmdb.release_date.slice(0, 4)) : 2020);
      } catch {}
    }

    // Extract data
    const title = tmdb.title;
    const originalTitle = tmdb.original_title;
    const year = tmdb.release_date ? parseInt(tmdb.release_date.slice(0, 4)) : 0;
    const runtime = tmdb.runtime || 0;
    const genres = (tmdb.genres || []).map((g: any) => g.name);
    const originalLanguage = tmdb.original_language || 'en';
    const rating = tmdb.vote_average || 0;
    const votes = tmdb.vote_count || 0;
    const popularity = tmdb.popularity || 0;
    const overview = tmdb.overview || '';
    const keywords = (tmdb.keywords?.keywords || []).map((k: any) => k.name);
    const cast = (tmdb.credits?.cast || []).slice(0, 10).map((c: any) => c.name);
    const director = (tmdb.credits?.crew || []).filter((c: any) => c.job === 'Director').map((c: any) => c.name).join(', ');

    // Certificate from OMDb
    let certificate = omdb?.Rated || '';
    if (certificate === 'N/A') certificate = '';

    // Tone scores
    const tones = computeToneScores(genres, keywords);

    // Embedding placeholder (will be filled in Step 4)
    const embedding: number[] = [];

    // Insert
    insertStmt.run({
      imdb_id: imdbId,
      tmdb_id: tmdbId,
      title,
      original_title: originalTitle,
      year,
      runtime: runtime || null,
      genres: JSON.stringify(genres),
      original_language: originalLanguage,
      certificate,
      rating,
      votes,
      popularity,
      overview,
      keywords: JSON.stringify(keywords),
      cast: JSON.stringify(cast),
      director: director || null,
      tone_energy: tones.energy,
      tone_darkness: tones.darkness,
      tone_humor: tones.humor,
      tone_emotional_weight: tones.emotional_weight,
      tone_complexity: tones.complexity,
      embedding: JSON.stringify(embedding),
    });

    return true;
  } catch (e: any) {
    console.error(`  ❌ Failed to ingest TMDB ${tmdbId}:`, e.message);
    return false;
  }
}

async function main() {
  console.log('🎬 Starting movie ingestion...');
  console.log(`   Target: 5000+ movies`);
  console.log(`   TMDB API: ${TMDB_API_KEY ? '✓' : '✗'}`);
  console.log(`   OMDB API: ${OMDB_API_KEY ? '✓' : '✗'}`);

  // Discover from multiple sort orders
  const sortOrders = [
    { sort: 'popularity.desc', pages: 50 },      // ~1000 movies
    { sort: 'vote_average.desc', pages: 30 },    // ~600 movies (high vote_count)
    { sort: 'vote_count.desc', pages: 30 },      // ~600 movies
    { sort: 'release_date.desc', pages: 30 },    // ~600 movies
    { sort: 'revenue.desc', pages: 20 },         // ~400 movies
  ];

  let totalDiscovered = 0;
  let totalIngested = 0;
  let totalSkipped = 0;

  for (const { sort, pages } of sortOrders) {
    console.log(`\n📥 Discovering from ${sort} (${pages} pages)...`);
    const ids = await discoverMovies(sort, pages);
    const uniqueIds = [...new Set(ids)];
    console.log(`   Found ${uniqueIds.length} unique movie IDs`);

    for (let i = 0; i < uniqueIds.length; i++) {
      const tmdbId = uniqueIds[i];
      const success = await ingestMovie(tmdbId);
      if (success) totalIngested++;
      else totalSkipped++;
      totalDiscovered++;

      if (totalDiscovered % 50 === 0) {
        const count = countStmt.get() as { count: number };
        console.log(`   Progress: ${totalDiscovered} processed, ${totalIngested} inserted, ${totalSkipped} skipped, DB: ${count.count} movies`);
      }

      // Stop if we have enough
      if (countStmt.get() && (countStmt.get() as { count: number }).count >= 5000) {
        console.log('\n✅ Reached 5000 movies target!');
        break;
      }
    }

    if (countStmt.get() && (countStmt.get() as { count: number }).count >= 5000) break;
  }

  // Final stats
  const finalCount = countStmt.get() as { count: number };
  console.log('\n📊 INGESTION COMPLETE');
  console.log(`   Total processed: ${totalDiscovered}`);
  console.log(`   Inserted: ${totalIngested}`);
  console.log(`   Skipped (existing/failed): ${totalSkipped}`);
  console.log(`   Database total: ${finalCount.count} movies`);

  // Column null rates
  const sample = db.prepare('SELECT * FROM movies LIMIT 1000').all() as Record<string, unknown>[];
  const columns = [
    'imdb_id', 'tmdb_id', 'title', 'year', 'runtime', 'genres',
    'original_language', 'certificate', 'rating', 'votes', 'overview',
    'keywords', 'cast', 'director',
    'tone_energy', 'tone_darkness', 'tone_humor', 'tone_emotional_weight', 'tone_complexity'
  ];
  
  console.log('\n📈 Column completeness (sample of 1000):');
  for (const col of columns) {
    const nonNull = sample.filter((r: Record<string, unknown>) => r[col] !== null && r[col] !== '' && r[col] !== '[]').length;
    const pct = ((nonNull / sample.length) * 100).toFixed(1);
    console.log(`   ${col}: ${pct}% (${nonNull}/${sample.length})`);
  }
}

main().catch(e => {
  console.error('❌ Ingestion failed:', e);
  process.exit(1);
});