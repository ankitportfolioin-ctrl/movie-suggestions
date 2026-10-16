/**
 * One shared movie pipeline used by BOTH /api/search and /api/recommend:
 * Postgres candidates (SQL WHERE) -> ranking.ts scorer -> gate last.
 * Falls back to data/movies.json, then the built-in catalog, with one log
 * line naming the fallback. Vercel-safe: one small pool (max 3), reused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { scoreMovie, selectDiverse } from './ranking.js';
import type { RankSignals } from './ranking.js';
import { enforceHardConstraints } from './gate.js';
import type { GateConstraints, GateMovie } from './gate.js';
import { FALLBACK_CATALOG } from './catalog.js';
import type { MovieItem } from './catalog.js';
import { fetchFromOMDb } from './omdb.js';

let pool: Pool | null = null;

/** Singleton pool; never closed (serverless reuse). Pooled DATABASE_URL expected in prod. */
export function getDbPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  }
  return pool;
}

export interface DbFilters {
  genres: string[]; // wanted, at least one match ([] = any)
  excludeGenres: string[];
  languages: string[]; // codes ([] = any)
  runtimeMin: number | null;
  runtimeMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  ratingFloor: number | null;
  audience: string;
  matureAllowed: boolean;
  excludeIds: number[];
  limit: number;
}

/** DB row + MovieItem shape carried through rank + gate. */
export interface DbItem extends MovieItem {
  minAge: number | null;
  tmdbId: number;
}

const DB_COLS = `tmdbId, imdbId, title, year, runtime, genres, originalLanguage,
  overview, rating, votes, popularity, posterPath, certificate, minAge, adult`;

/** Pure SQL builder (tested without a database). */
export function buildWhereClause(f: DbFilters): { text: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const next = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.genres.length > 0) clauses.push(`genres && ${next(f.genres)}`);
  if (f.excludeGenres.length > 0) clauses.push(`NOT (genres && ${next(f.excludeGenres)})`);
  if (f.languages.length > 0) clauses.push(`originalLanguage = ANY(${next(f.languages)})`);
  if (f.runtimeMin !== null) clauses.push(`runtime >= ${next(f.runtimeMin)}`);
  if (f.runtimeMax !== null) clauses.push(`runtime <= ${next(f.runtimeMax)}`);
  if (f.yearMin !== null) clauses.push(`year >= ${next(f.yearMin)}`);
  if (f.yearMax !== null) clauses.push(`year <= ${next(f.yearMax)}`);
  if (f.ratingFloor !== null) clauses.push(`rating >= ${next(f.ratingFloor)}`);
  if (f.excludeIds.length > 0) clauses.push(`NOT (tmdbId = ANY(${next(f.excludeIds)}))`);
  if (f.audience === 'Family with kids') {
    clauses.push(`((minAge IS NOT NULL AND minAge <= 6) OR (minAge IS NULL AND ` +
      `genres && '{Family,Animation}' AND NOT (genres && '{Horror,Crime,Thriller,War}')))`);
  } else if (!f.matureAllowed) {
    clauses.push(`((minAge IS NULL OR minAge < 16) AND ` +
      `NOT (minAge IS NULL AND genres && '{Horror}'))`);
  }
  return { text: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function toDbItem(r: Record<string, unknown>): DbItem {
  const poster = typeof r.posterpath === 'string' ? r.posterpath : null;
  return {
    id: r.tmdbid as number,
    tmdbId: r.tmdbid as number,
    imdbId: (r.imdbid as string) || '',
    title: r.title as string,
    year: r.year as number,
    genres: (r.genres as string[]) || [],
    runtime: r.runtime as number,
    rating: (r.rating as number) ?? 0,
    voteCount: (r.votes as number) ?? 0,
    popularity: (r.popularity as number) ?? 0,
    overview: (r.overview as string) || '',
    posterUrl: poster ? `https://image.tmdb.org/t/p/w342${poster}` : '',
    language: (r.originallanguage as string) || 'en',
    isMature: r.adult === true,
    isHiddenGem: false,
    providers: [],
    certificate: (r.certificate as string) || '',
    minAge: (r.minage as number) ?? null,
  };
}

export async function queryDbCandidates(f: DbFilters): Promise<DbItem[]> {
  const { text, params } = buildWhereClause(f);
  const { rows } = await getDbPool().query(
    `SELECT ${DB_COLS} FROM movies ${text} ORDER BY popularity DESC NULLS LAST LIMIT $${params.length + 1}`,
    [...params, f.limit],
  );
  return rows.map(toDbItem);
}

interface Filterable {
  genres: string[];
  language: string;
  runtime: number;
  year: number;
  rating: number;
  minAge?: number | null;
}

/** JS mirror of the SQL predicates for the file/catalog fallbacks (tested). */
export function matchesFilters(m: Filterable, f: DbFilters): boolean {
  if (f.genres.length > 0 && !m.genres.some((g) => f.genres.includes(g))) return false;
  if (m.genres.some((g) => f.excludeGenres.includes(g))) return false;
  if (f.languages.length > 0 && !f.languages.includes(m.language)) return false;
  if (f.runtimeMin !== null && !(m.runtime >= f.runtimeMin)) return false;
  if (f.runtimeMax !== null && !(m.runtime > 0 && m.runtime <= f.runtimeMax)) return false;
  if (f.yearMin !== null && !(m.year >= f.yearMin)) return false;
  if (f.yearMax !== null && !(m.year <= f.yearMax)) return false;
  if (f.ratingFloor !== null && !(m.rating >= f.ratingFloor)) return false;
  if (f.audience === 'Family with kids') {
    if (typeof m.minAge === 'number') { if (m.minAge > 6) return false; }
    else if (!(m.genres.includes('Family') || m.genres.includes('Animation')) ||
      m.genres.some((g) => ['Horror', 'Crime', 'Thriller', 'War'].includes(g))) return false;
  } else if (!f.matureAllowed) {
    if (typeof m.minAge === 'number') { if (m.minAge >= 16) return false; }
    else if (m.genres.includes('Horror')) return false;
  }
  return true;
}

function jsonToItem(r: Record<string, unknown>): DbItem {
  const poster = typeof r.posterPath === 'string' ? r.posterPath : null;
  return {
    id: r.tmdbId as number, tmdbId: r.tmdbId as number,
    imdbId: (r.imdbId as string) || '', title: r.title as string, year: r.year as number,
    genres: (r.genres as string[]) || [], runtime: r.runtime as number,
    rating: (r.rating as number) ?? 0, voteCount: (r.votes as number) ?? 0, popularity: 0,
    overview: (r.overview as string) || '',
    posterUrl: poster ? `https://image.tmdb.org/t/p/w342${poster}` : '',
    language: (r.originalLanguage as string) || 'en', isMature: false, isHiddenGem: false,
    providers: [], certificate: (r.certificate as string) || '', minAge: null,
  };
}

/** DB -> movies.json -> catalog, with one log line naming any fallback used. */
export async function loadDbCandidates(f: DbFilters): Promise<{ items: DbItem[]; source: string }> {
  if (process.env.DATABASE_URL) {
    try {
      return { items: await queryDbCandidates(f), source: 'db' };
    } catch {
      // fall through to files below
    }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'data', 'movies.json'), 'utf8'));
    const rows = (Array.isArray(raw) ? raw : []).map(jsonToItem).filter((m) => matchesFilters(m, f));
    console.warn('[dbMovies] fallback: data/movies.json (postgres unreachable)');
    return { items: rows.slice(0, f.limit), source: 'movies.json' };
  } catch {
    console.warn('[dbMovies] fallback: built-in catalog (postgres + movies.json unavailable)');
    const rows: DbItem[] = FALLBACK_CATALOG.filter((m) => matchesFilters({ ...m, minAge: null }, f))
      .map((m) => ({ ...m, minAge: null, tmdbId: m.id }));
    return { items: rows.slice(0, f.limit), source: 'catalog' };
  }
}

/** Rank with ranking.ts, then gate last. Returns match-scored picks + disclosures. */
export function rankGateMovies(
  items: DbItem[], signals: RankSignals, gate: GateConstraints, count: number,
): { movies: (DbItem & { matchScore: number })[]; relaxed: string[] } {
  const scored = items.map((movie) => ({ movie, score: scoreMovie(movie, signals) }));
  const diverse = selectDiverse(scored, count, false);
  const ms = new Map(diverse.map((d) => [d.movie.id, d.matchScore]));
  const gated = enforceHardConstraints<DbItem & GateMovie>(
    diverse.map((d) => d.movie), gate);
  return {
    movies: gated.movies.map((m) => ({ ...m, matchScore: ms.get(m.id) ?? 95 })),
    relaxed: gated.relaxed,
  };
}

// OMDb US ratings for the NULL-minAge backfill on final picks only.
const OMDB_RATED_AGE: Record<string, number> = {
  G: 0, 'TV-G': 0, 'TV-Y': 0, 'TV-Y7': 6, PG: 6, 'TV-PG': 6,
  'PG-13': 12, 'TV-14': 12, R: 16, 'TV-MA': 16, 'NC-17': 18,
};

/**
 * For final picks only: NULL minAge -> OMDb Rated by imdbId, cached in the
 * DB, maturity re-applied. Failed lookup keeps the pick with a
 * "Rating not confirmed" card note.
 */
export async function ensureMinAge<T extends DbItem>(
  picks: T[], audience: string, matureAllowed: boolean,
): Promise<{ movies: (T & { ratingNote?: string })[]; notices: string[] }> {
  const key = process.env.OMDB_API_KEY?.trim();
  const movies: (T & { ratingNote?: string })[] = [];
  const notices: string[] = [];
  const gate: GateConstraints = {
    maxMinutes: Infinity, maxRuntimeLabel: '', langCodes: [],
    highlyRated: false, recent: false, classics: false, audience, matureAllowed,
  };
  for (const pick of picks) {
    if (typeof pick.minAge === 'number' || !pick.imdbId || !key) {
      if (pick.minAge === null || pick.minAge === undefined) {
        movies.push({ ...pick, ratingNote: 'Rating not confirmed' });
      } else movies.push(pick);
      continue;
    }
    let data: { Rated?: string } | null = null;
    try {
      data = await fetchFromOMDb({ imdbId: pick.imdbId }, key);
    } catch { data = null; }
    const age = data?.Rated ? OMDB_RATED_AGE[data.Rated.trim().toUpperCase()] : undefined;
    if (age === undefined || !data?.Rated) {
      movies.push({ ...pick, ratingNote: 'Rating not confirmed' });
      continue;
    }
    const cert = data.Rated.trim();
    try {
      await getDbPool().query('UPDATE movies SET certificate = $1, minAge = $2 WHERE tmdbId = $3',
        [cert, age, pick.tmdbId]);
    } catch { /* cache write must never fail the request */ }
    const aged = { ...pick, certificate: cert, minAge: age };
    if (enforceHardConstraints([aged], gate).movies.length === 1) movies.push(aged);
    else notices.push(`Removed "${pick.title}" after its rating came back as ${cert}.`);
  }
  return { movies, notices };
}
