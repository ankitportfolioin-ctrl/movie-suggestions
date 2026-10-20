/**
 * One shared movie pipeline used by BOTH /api/search and /api/recommend:
 * Postgres candidates (SQL WHERE) -> ranking.ts scorer -> gate last.
 * Falls back to data/movies.json, then the built-in catalog, with one log
 * line naming the fallback. Vercel-safe: one small pool (max 3), reused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { scoreWithFeatures, selectDiverse, buildReason } from './ranking.js';
import type { RankSignals } from './ranking.js';
import { enforceHardConstraints } from './gate.js';
import type { GateConstraints, GateMovie } from './gate.js';
import { FALLBACK_CATALOG } from './catalog.js';
import type { MovieItem } from './catalog.js';
import { fetchFromOMDb, LANGUAGE_CODES, normalizeTitle } from './omdb.js';
import { canonicalGenres, expandGenres } from './genres.js';

/** Reverse lookup: ISO code -> quiz label ("ko" -> "Korean"). */
function languageLabel(code: string): string | undefined {
  for (const [name, c] of Object.entries(LANGUAGE_CODES)) if (c === code) return name;
  return undefined;
}

let pool: Pool | null = null;

/** Singleton pool; never closed (serverless reuse). Pooled DATABASE_URL expected in prod. */
export function getDbPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    // D15: cap every upstream wait. Without these, a dead serverless
    // connection hangs on the OS TCP timeout (~20s) before its catch fires.
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 5000,
    });
  }
  return pool;
}

export interface DbFilters {
  /** Media kinds to include ([] = any). Default at every caller: ['movie']. */
  types: string[];
  genres: string[]; // wanted, at least one match ([] = any)
  excludeGenres: string[];
  languages: string[]; // codes ([] = any)
  runtimeMin: number | null;
  runtimeMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  ratingFloor: number | null;
  /** Series only: max season count (1 = miniseries). null = no limit. */
  seasonsMax: number | null;
  audience: string;
  matureAllowed: boolean;
  excludeIds: number[];
  limit: number;
}

/** DB row + MovieItem shape carried through rank + gate. */
export interface DbItem extends MovieItem {
  minAge: number | null;
  tmdbId: number;
  /** 'movie' (41+ min), 'short' (1-40 min) or 'series'. */
  type?: string;
  seasons?: number;
  episodes?: number;
  /** Series: one episode's length (also mirrored into `runtime`). */
  episodeRuntime?: number;
  status?: string;
  network?: string;
  firstAirYear?: number;
  lastAirYear?: number;
  webSeries?: boolean;
}

const DB_COLS = `tmdbId, imdbId, title, year, runtime, genres, originalLanguage,
  overview, rating, votes, popularity, posterPath, certificate, minAge, adult,
  type, seasons, episodes, episodeRuntime, status, network, firstAirYear, lastAirYear, webSeries`;

/** Pure SQL builder (tested without a database). */
export function buildWhereClause(f: DbFilters): { text: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const next = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.genres.length > 0) clauses.push(`genres && ${next(expandGenres(f.genres))}`);
  if (f.excludeGenres.length > 0) clauses.push(`NOT (genres && ${next(expandGenres(f.excludeGenres))})`);
  if (f.languages.length > 0) clauses.push(`originalLanguage = ANY(${next(f.languages)})`);
  if (f.runtimeMin !== null) clauses.push(`runtime > ${next(f.runtimeMin)}`);
  if (f.runtimeMax !== null) clauses.push(`runtime <= ${next(f.runtimeMax)}`);
  if (f.yearMin !== null) clauses.push(`year >= ${next(f.yearMin)}`);
  if (f.yearMax !== null) clauses.push(`year <= ${next(f.yearMax)}`);
  if (f.ratingFloor !== null) clauses.push(`rating >= ${next(f.ratingFloor)}`);
  if (f.excludeIds.length > 0) clauses.push(`NOT (tmdbId = ANY(${next(f.excludeIds)}))`);
  // Type clause after the existing params so old call shapes keep their order.
  if (f.types.length > 0) clauses.push(`type = ANY(${next(f.types)})`);
  if (f.seasonsMax !== null) clauses.push(`seasons <= ${next(f.seasonsMax)}`);
  if (f.audience === 'Family with kids') {
    clauses.push(`((minAge IS NOT NULL AND minAge <= 6) OR (minAge IS NULL AND ` +
      `genres && '{Family,Animation}' AND NOT (genres && '{Horror,Crime,Thriller,War}')))`);
  } else if (!f.matureAllowed) {
    // Non-family: block adult-only content. The cap is 16 — except when the
    // viewer EXPLICITLY named language(s) (e.g. "Kannada movie"): then the
    // viewer asked for that industry's catalog and 15/17-certified rows
    // (ingest-tagged 16) may serve; OMDb backfill still scrubs truly adult.
    const cap = f.languages.length > 0 ? 18 : 16;
    clauses.push(`((minAge IS NULL OR minAge < ${cap}) AND ` +
      `NOT (minAge IS NULL AND genres && '{Horror}'))`);
  }
  return { text: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function toDbItem(r: Record<string, unknown>): DbItem {
  const poster = typeof r.posterpath === 'string' ? r.posterpath : null;
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return {
    id: r.tmdbid as number,
    tmdbId: r.tmdbid as number,
    imdbId: (r.imdbid as string) || '',
    title: r.title as string,
    year: r.year as number,
    genres: canonicalGenres((r.genres as string[]) || []),
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
    type: (r.type as string) || 'movie',
    seasons: num(r.seasons),
    episodes: num(r.episodes),
    episodeRuntime: num(r.episoderuntime),
    status: (r.status as string) || undefined,
    network: (r.network as string) || undefined,
    firstAirYear: num(r.firstairyear),
    lastAirYear: num(r.lastairyear),
    webSeries: r.webseries === true,
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

/**
 * Reference anchors ("like Arrival") are the user's own examples, not
 * candidates: fetch their rows by title, bypassing candidate filters so a
 * 16+ reference still anchors similarity. [] when the DB cannot answer —
 * callers disclose the miss instead of guessing.
 */
export async function loadReferenceAnchors(titles: string[]): Promise<DbItem[]> {
  if (titles.length === 0 || !process.env.DATABASE_URL) return [];
  // Exact or prefix match: "Baahubali" anchors "Baahubali: The Beginning".
  // Punctuation/case-insensitive; translate() folds diacritics so accent
  // spellings ("Bāhubali") anchor too. 20-row cap keeps it honest.
  const normalized = titles.map(normalizeTitle).filter(Boolean);
  const lowered = titles.map((t) => t.trim().toLowerCase()).filter(Boolean);
  // Double-letter collapse ("baahubali" == "bahubali") on top of diacritic
  // folding: "Bāhubali" folds to "bahubali" and the user's "baahubali"
  // collapses to the same stem.
  const squashed = normalized.map((n) => n.replace(/(.)\1+/g, '$1')).filter(Boolean);
  const FOLD_FROM = 'āàáâäãåēèéêëīìíîïōòóôöõùúûüñçšž';
  const FOLD_TO = 'aaaaaaeeeeeiiiiioooooouuuuuncsz';
  try {
    const { rows } = await getDbPool().query(
      `SELECT ${DB_COLS} FROM movies
       WHERE regexp_replace(lower(title), '[^a-z0-9]', '', 'g') = ANY($1)
          OR regexp_replace(lower(title), '[^a-z0-9]', '', 'g') LIKE ANY($2)
          OR lower(title) = ANY($3)
          OR lower(title) LIKE ANY($4)
          OR regexp_replace(translate(lower(title), $5, $6), '[^a-z0-9]', '', 'g') = ANY($7)
          OR regexp_replace(translate(lower(title), $5, $6), '[^a-z0-9]', '', 'g') LIKE ANY($8)
          OR regexp_replace(
               regexp_replace(translate(lower(title), $5, $6), '(.)\\1+', '\\1', 'g'),
               '[^a-z0-9]', '', 'g') = ANY($7)
          OR regexp_replace(
               regexp_replace(translate(lower(title), $5, $6), '(.)\\1+', '\\1', 'g'),
               '[^a-z0-9]', '', 'g') LIKE ANY($8)
       LIMIT 20`,
      [
        normalized, normalized.map((n) => `${n}%`), lowered,
        lowered.map((l) => `${l.replace(/'/g, "''")}%`),
        FOLD_FROM, FOLD_TO, squashed, squashed.map((s) => `${s}%`),
      ],
    );
    return rows.map(toDbItem);
  } catch {
    return [];
  }
}

interface Filterable {
  genres: string[];
  language: string;
  runtime: number;
  year: number;
  rating: number;
  minAge?: number | null;
  /** Media kind; absent means 'movie' (file/catalog fallbacks). */
  type?: string;
  seasons?: number;
}

/** JS mirror of the SQL predicates for the file/catalog fallbacks (tested). */
export function matchesFilters(m: Filterable, f: DbFilters): boolean {
  if (f.types.length > 0 && !f.types.includes(m.type ?? 'movie')) return false;
  if (f.seasonsMax !== null && !(typeof m.seasons === 'number' && m.seasons <= f.seasonsMax)) return false;
  const wanted = expandGenres(f.genres);
  const banned = expandGenres(f.excludeGenres);
  if (f.genres.length > 0 && !m.genres.some((g) => wanted.includes(g))) return false;
  if (m.genres.some((g) => banned.includes(g))) return false;
  if (f.languages.length > 0 && !f.languages.includes(m.language)) return false;
  if (f.runtimeMin !== null && !(m.runtime > f.runtimeMin)) return false;
  if (f.runtimeMax !== null && !(m.runtime > 0 && m.runtime <= f.runtimeMax)) return false;
  if (f.yearMin !== null && !(m.year >= f.yearMin)) return false;
  if (f.yearMax !== null && !(m.year <= f.yearMax)) return false;
  if (f.ratingFloor !== null && !(m.rating >= f.ratingFloor)) return false;
  if (f.audience === 'Family with kids') {
    if (typeof m.minAge === 'number') { if (m.minAge > 6) return false; }
    else if (!(m.genres.includes('Family') || m.genres.includes('Animation')) ||
      m.genres.some((g) => ['Horror', 'Crime', 'Thriller', 'War'].includes(g))) return false;
  } else if (!f.matureAllowed) {
    if (typeof m.minAge === 'number') {
      // Explicit-language asks trust the viewer's catalog request (see SQL twin).
      if (m.minAge >= (f.languages.length > 0 ? 18 : 16)) return false;
    } else if (m.genres.includes('Horror')) return false;
  }
  return true;
}

function jsonToItem(r: Record<string, unknown>): DbItem {
  const poster = typeof r.posterPath === 'string' ? r.posterPath : null;
  return {
    id: r.tmdbId as number, tmdbId: r.tmdbId as number,
    imdbId: (r.imdbId as string) || '', title: r.title as string, year: r.year as number,
    genres: canonicalGenres((r.genres as string[]) || []), runtime: r.runtime as number,
    rating: (r.rating as number) ?? 0, voteCount: (r.votes as number) ?? 0, popularity: 0,
    overview: (r.overview as string) || '',
    posterUrl: poster ? `https://image.tmdb.org/t/p/w342${poster}` : '',
    language: (r.originalLanguage as string) || 'en', isMature: false, isHiddenGem: false,
    providers: [], certificate: (r.certificate as string) || '', minAge: null,
    type: typeof r.type === 'string' ? r.type : 'movie',
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

export interface EmptyPoolCounts {
  genres: number; languages: number; runtime: number;
  year: number; rating: number; maturity: number;
}

/** Pure: name the constraint whose removal refills the pool (tested). */
export function pickEmptyCause(n: EmptyPoolCounts, f: DbFilters): string | null {
  if (n.genres > 0) return `Nothing in ${f.genres.join(' / ')} fits your other filters — try a different genre or widen the year.`;
  if (n.languages > 0) return 'Nothing in that language fits your other filters — try Any language.';
  if (n.runtime > 0) return 'Nothing fits that length — try widening the runtime.';
  if (n.year > 0) return 'Nothing from those years fits — try widening the year range.';
  if (n.rating > 0) return 'Nothing rated that high fits — try dropping "highly rated".';
  if (n.maturity > 0) return 'Your maturity setting filtered everything out — what matches is 16+ or Horror.';
  return null;
}

/**
 * Empty pool honesty: drop each constraint once and count. Names the one
 * that emptied the pool, with a suggestion. Null when nothing single-handedly
 * did (or the DB is unreachable — caller falls back to a generic notice).
 */
export async function diagnoseEmptyPool(f: DbFilters): Promise<string | null> {
  const relaxed: DbFilters[] = [
    { ...f, genres: [] },
    { ...f, languages: [] },
    { ...f, runtimeMin: null, runtimeMax: null },
    { ...f, yearMin: null, yearMax: null },
    { ...f, ratingFloor: null },
    { ...f, audience: 'Just me', matureAllowed: true },
  ];
  try {
    const counts = await Promise.all(relaxed.map(async (rf) => {
      const { text, params } = buildWhereClause(rf);
      const { rows } = await getDbPool().query(
        `SELECT count(*)::int AS n FROM movies ${text}`, params);
      return rows[0].n as number;
    }));
    const n: EmptyPoolCounts = {
      genres: counts[0], languages: counts[1], runtime: counts[2],
      year: counts[3], rating: counts[4], maturity: counts[5],
    };
    return pickEmptyCause(n, f);
  } catch {
    return null;
  }
}

/** Rank with ranking.ts, then gate last. Returns fit-scored picks + disclosures. */
export function rankGateMovies(
  items: DbItem[], signals: RankSignals, gate: GateConstraints, count: number,
): { movies: (DbItem & { fitScore: number; reason: string })[]; relaxed: string[] } {
  const scored = items.map((movie) => {
    const breakdown = scoreWithFeatures(movie, signals, { languageLabel: languageLabel(movie.language) });
    return { movie, score: breakdown.score, features: breakdown.features };
  });
  const diverse = selectDiverse(scored, count, false);
  const byId = new Map(diverse.map((d) => [d.movie.id, d]));
  const gated = enforceHardConstraints<DbItem & GateMovie>(
    diverse.map((d) => d.movie), gate);
  return {
    movies: gated.movies.map((m) => {
      const d = byId.get(m.id);
      return { ...m, fitScore: d?.fitScore ?? 95, reason: buildReason(d?.features ?? []) };
    }),
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
 * "Rating not confirmed" card note. Types/seasonsMax default to the movie
 * contract so existing callers keep their behavior.
 */
export async function ensureMinAge<T extends DbItem>(
  picks: T[], audience: string, matureAllowed: boolean,
  types: string[] = ['movie'], seasonsMax: number | null = null,
): Promise<{ movies: (T & { ratingNote?: string })[]; notices: string[] }> {
  const key = process.env.OMDB_API_KEY?.trim();
  const movies: (T & { ratingNote?: string })[] = [];
  const notices: string[] = [];
  const gate: GateConstraints = {
    maxMinutes: Infinity, maxRuntimeLabel: '', langCodes: [],
    highlyRated: false, recent: false, classics: false, audience, matureAllowed,
    types, seasonsMax,
  };
  // D15: all OMDb lookups run in parallel — three sequential 3s calls blew
  // the total budget; parallel keeps the pick order. Each call already
  // aborts at 3s (fetchFromOMDb's own timeout).
  const needLookup = picks.filter(
    (p) => typeof p.minAge !== 'number' && p.imdbId && key,
  );
  const lookups = new Map<string, { Rated?: string } | null>();
  if (key) {
    await Promise.all(needLookup.map(async (p) => {
      const imdbId = p.imdbId as string;
      const data = await Promise.race([
        fetchFromOMDb({ imdbId }, key).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 3500)),
      ]);
      lookups.set(imdbId, data);
    }));
  }
  for (const pick of picks) {
    if (typeof pick.minAge === 'number' || !pick.imdbId || !key) {
      if (pick.minAge === null || pick.minAge === undefined) {
        movies.push({ ...pick, ratingNote: 'Rating not confirmed' });
      } else movies.push(pick);
      continue;
    }
    const data = lookups.get(pick.imdbId) ?? null;
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
