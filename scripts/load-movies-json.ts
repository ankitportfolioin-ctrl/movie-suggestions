/**
 * Loads data/movies.json into Postgres (upsert: re-running never duplicates).
 * Fields absent from the JSON (originalTitle, spokenLanguages, popularity,
 * minAge, productionCountries) stay NULL/empty; the global ingest fills them.
 * Usage: npm run db:load
 */
import fs from 'node:fs';
import path from 'node:path';
import { dbQuery, getPool, isDbConfigured } from '../server/db.js';

export interface JsonMovie {
  tmdbId: number;
  imdbId?: string | null;
  title: string;
  year: number;
  runtime: number;
  genres: string[];
  originalLanguage: string;
  overview: string;
  rating: number;
  votes: number;
  posterPath?: string | null;
  certificate?: string;
  keywords?: string[];
}

const COLS = ['tmdbId', 'imdbId', 'title', 'year', 'runtime', 'genres', 'originalLanguage', 'overview', 'rating', 'votes', 'posterPath', 'certificate', 'keywords'] as const;

export async function upsertMovies(rows: JsonMovie[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const params: unknown[] = [];
    const tuples = batch.map((m) => {
      const vals = [
        m.tmdbId, m.imdbId ?? null, m.title, m.year, m.runtime,
        m.genres ?? [], m.originalLanguage ?? null, m.overview ?? null,
        m.rating ?? null, m.votes ?? 0, m.posterPath ?? null,
        m.certificate || null, m.keywords ?? [],
      ];
      const base = params.length;
      vals.forEach((v) => params.push(v));
      return `(${vals.map((_, k) => `$${base + k + 1}`).join(',')})`;
    });
    const updates = COLS.slice(1).map((c) => `${c}=EXCLUDED.${c}`).join(',');
    await dbQuery(
      `INSERT INTO movies (${COLS.join(',')}) VALUES ${tuples.join(',')} ON CONFLICT (tmdbId) DO UPDATE SET ${updates}, updatedAt=NOW()`
    , params);
    n += batch.length;
  }
  return n;
}

async function main(): Promise<void> {
  if (!isDbConfigured()) {
    console.log('DATABASE_URL is not set. NOT RUN: set DATABASE_URL, re-run npm run db:load.');
    process.exit(3);
  }
  const file = path.resolve(process.cwd(), 'data', 'movies.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as JsonMovie[];
  const n = await upsertMovies(rows);
  const [{ count }] = await dbQuery<{ count: string }>('SELECT count(*) FROM movies');
  console.log(`loaded ${n} rows from data/movies.json, table now holds ${count}`);
  await getPool().end();
}

if (process.argv[1]?.endsWith('load-movies-json.ts')) {
  await main();
}
