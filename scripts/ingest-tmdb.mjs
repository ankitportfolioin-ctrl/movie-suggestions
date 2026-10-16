/**
 * TMDB global ingest: upserts movies straight into Postgres (>=3000 movies
 * covering every genre, language and era the recommender must serve).
 *
 * Usage: npm run ingest:tmdb [-- --limit N] [--mode ingest|backfill-cert]
 *   --limit N caps NEW detail fetches this run (default 0 = no limit).
 *   --mode backfill-cert (or --backfill-cert) only re-fetches release_dates
 *     for rows where minAge IS NULL and updates certificate + minAge.
 * Reads TMDB_API_KEY + DATABASE_URL from env (or .env file).
 * Safe to re-run: tmdbIds already in the DB are skipped, every batch is
 * upserted before continuing. Never writes or commits a data file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Standard TMDB movie genre ids.
const GENRE_IDS = {
  Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80,
  Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36,
  Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749,
  "Science Fiction": 878, Thriller: 53, War: 10752, Western: 37,
};

// Coverage targets (unchanged from the file-based ingest spec).
const TARGET_GENRES = ["Action", "Adventure", "Animation", "Comedy", "Crime",
  "Documentary", "Drama", "Family", "Fantasy", "Horror", "Mystery",
  "Romance", "Sci-Fi", "Thriller"];
const TARGET_LANGS = { hi: 100, ta: 100, te: 100, ko: 100, ja: 100, es: 100, fr: 100 };
const TARGET_EN = 1000;
const TARGET_PRE1990 = 300;
const TARGET_RECENT = 300; // year >= 2023
const TARGET_SHORT_EN = 60; // <90 min English
const TARGET_SHORT_HI = 60; // <90 min Hindi
const TARGET_TOTAL = 3000;
const MAX_DETAILS = 20000; // absolute safety cap on API usage per run

// Pacing: ~12 req/s total (80ms between starts) with 5 concurrent workers.
const MIN_START_GAP_MS = 80;
const CONCURRENCY = 5;
const BATCH_SIZE = 50;
// Stop this many minutes before the job timeout so the report always prints.
const STOP_EARLY_MIN = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnv() {
  const out = { ...process.env };
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
  }
  return out;
}

function parseLimit(argv) {
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--limit(?:=(\d+))?$/);
    if (m) {
      if (m[1] !== undefined) return Number(m[1]);
      const next = Number(argv[i + 1]);
      if (Number.isInteger(next) && next >= 0) return next;
      throw new Error("usage: ingest-tmdb.mjs --limit N (N >= 0)");
    }
  }
  return 0;
}

function parseMode(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--backfill-cert") return "backfill-cert";
    const m = argv[i].match(/^--mode(?:=(.+))?$/);
    if (m) {
      const v = m[1] !== undefined ? m[1] : argv[i + 1];
      if (v !== "ingest" && v !== "backfill-cert") throw new Error("usage: --mode ingest|backfill-cert");
      return v;
    }
  }
  return "ingest";
}

// pg lowercases unquoted column names, so rows carry `tmdbid`, not `tmdbId`.
export function pgIds(rows) {
  return rows.map((r) => r.tmdbid);
}

/** minAge from a stored US/IN/GB certificate, or null when unknown. */
export function storedCertAge(cert) {
  const raw = typeof cert === "string" ? cert.trim() : "";
  if (!raw) return null;
  const key = raw.toUpperCase();
  for (const country of ["US", "IN", "GB"]) {
    if (key in CERT_MIN_AGE[country]) return { certificate: raw, minAge: CERT_MIN_AGE[country][key] };
  }
  return null;
}

/**
 * Certificate -> minAge mapping per country. Values are only ever
 * 0, 6, 12, 16 or 18. Keys are upper-cased, trimmed TMDB certifications.
 * Unknown certs fall back to numeric parsing in certToMinAge().
 */
export const CERT_MIN_AGE = {
  US: { G: 0, PG: 6, "PG-13": 12, R: 16, "NC-17": 18, X: 18, NR: 0, UR: 0, "NOT RATED": 0, "TV-Y": 0, "TV-G": 0, "TV-Y7": 6, "TV-PG": 6, "TV-14": 12, "TV-MA": 16 },
  IN: { U: 0, UA: 6, "U/A": 6, "UA 7+": 6, "UA7+": 6, "UA 13+": 12, "UA13+": 12, "UA 16+": 16, "UA16+": 16, A: 18, S: 18 },
  GB: { U: 0, UC: 0, PG: 6, 12: 12, "12A": 12, 15: 16, 18: 18, R18: 18 },
  DE: { "FSK 0": 0, "FSK 6": 6, "FSK 12": 12, "FSK 16": 16, "FSK 18": 18, 0: 0, 6: 6, 12: 12, 16: 16, 18: 18, OA: 0 },
  FR: { U: 0, "TOUS PUBLICS": 0, 10: 6, "INTERDIT -10": 6, "-10": 6, 12: 12, "-12": 12, 16: 16, "-16": 16, 18: 18, "-18": 18, X: 18 },
  KR: { ALL: 0, "전체": 0, 7: 6, "7+": 6, 12: 12, "12+": 12, 15: 16, "15+": 16, 18: 18, "18+": 18, 19: 18, "19+": 18, "청소년 관람불가": 18 },
  JP: { G: 0, PG12: 12, "PG-12": 12, "R15+": 16, "R15": 16, "R18+": 18, "R18": 18 },
  BR: { L: 0, LIVRE: 0, 10: 6, 12: 12, 14: 16, 16: 16, 18: 18 },
  AU: { G: 0, PG: 6, M: 12, "MA15+": 16, "MA 15+": 16, "R18+": 18, "X18+": 18, RC: 18 },
  ES: { A: 0, APTA: 0, "APTA PARA TODOS LOS PÚBLICOS": 0, 7: 6, "NO RECOMENDADA PARA MENORES DE 7": 6, 12: 12, 16: 16, 18: 18, X: 18 },
  IT: { T: 0, "FILM PER TUTTI": 0, "6+": 6, VM6: 6, "10+": 12, VM10: 12, "14+": 16, VM14: 16, "18+": 18, VM18: 18 },
  RU: { "0+": 0, "6+": 6, "12+": 12, "16+": 16, "18+": 18 },
  CA: { G: 0, PG: 6, "14A": 12, "18A": 16, R: 18, A: 18, E: 0, C: 0, C8: 6, C13: 12, C16: 16, C18: 18 },
  MX: { A: 0, AA: 0, B: 6, "B-15": 16, "B15": 16, C: 18, D: 18 },
  TR: { GENEL: 0, "GENEL İZLEYİCİ": 0, "6+": 6, "6A": 6, "10+": 12, "10A": 12, "13+": 12, "13A": 12, "16+": 16, "16A": 16, "18+": 18 },
  NL: { AL: 0, MG6: 6, 6: 6, 9: 6, "9+": 6, 12: 12, 14: 16, 16: 16, 18: 18 },
  SE: { BTL: 0, BARNTILLÅTEN: 0, 7: 6, "7+": 6, 11: 12, "11+": 12, 15: 16, "15+": 16 },
  PL: { BO: 0, "BEZ OGRANICZEŃ": 0, 7: 6, "7+": 6, 12: 12, "12+": 12, 15: 16, "15+": 16, 18: 18, "18+": 18, AP: 0 },
  TH: { "ทั่วไป": 0, G: 0, U: 0, 13: 12, "13+": 12, 15: 16, "15+": 16, 18: 18, "18+": 18, 20: 18, "20+": 18 },
  ID: { SU: 0, A: 0, "BO (BIMBINGAN ORANG TUA)": 6, BO: 6, "7+": 6, "13+": 12, "16+": 16, "18+": 18, "21+": 18 },
  SG: { G: 0, PG: 6, PG13: 12, "PG-13": 12, NC16: 16, M18: 18, R21: 18 },
  ZA: { A: 0, PG: 6, "7-9PG": 6, "10-12PG": 12, 13: 12, 16: 16, 18: 18, XX: 18, X18: 18 },
};

// Certs that mean "all ages" in any country (checked before numeric parsing).
const ALL_AGES = new Set(["G", "U", "L", "AA", "A", "AL", "T", "SU", "LIVRE", "ALL", "GENEL", "BTL", "APT", "APTA", "BO", "E", "C", "OA", "UC", "TUTTI", "Tutti"]);

function numToMinAge(n) {
  if (n <= 0) return 0;
  if (n <= 6) return 6;
  if (n <= 12) return 12;
  if (n <= 16) return 16;
  return 18;
}

/** Map one country's raw certificate to a minAge, or null when unknown. */
export function certToMinAge(country, cert) {
  if (!cert) return null;
  const key = String(cert).trim().toUpperCase();
  if (!key) return null;
  const table = CERT_MIN_AGE[country];
  if (table && key in table) return table[key];
  if (ALL_AGES.has(key)) return 0;
  const m = key.match(/\d+/);
  if (m) return numToMinAge(Number(m[0]));
  return null;
}

/**
 * Read release_dates for ALL countries and return the raw certificate plus
 * the HIGHEST minAge across countries that disagree.
 */
export function releaseInfo(details) {
  const results = (details.release_dates && details.release_dates.results) || [];
  let best = { certificate: "", minAge: null };
  for (const entry of results) {
    for (const r of entry.release_dates || []) {
      const raw = (r.certification || "").trim();
      if (!raw) continue;
      const age = certToMinAge(entry.iso_3166_1, raw);
      if (age === null) continue;
      if (best.minAge === null || age > best.minAge) best = { certificate: raw, minAge: age };
    }
  }
  return best;
}

function keepMovie(d) {
  if (!d || d.adult === true) return null;
  const year = typeof d.release_date === "string" ? parseInt(d.release_date.slice(0, 4), 10) : NaN;
  const runtime = typeof d.runtime === "number" ? d.runtime : 0;
  const rating = typeof d.vote_average === "number" ? Math.round(d.vote_average * 10) / 10 : 0;
  if (!Number.isFinite(year) || runtime <= 40 || !d.overview || !rating) return null;
  const genres = Array.isArray(d.genres) ? d.genres.map((g) => g.name).filter(Boolean) : [];
  if (genres.length === 0) return null;
  const keywords = (((d.keywords || {}).keywords) || []).map((k) => k.name).filter(Boolean).slice(0, 10);
  const { certificate, minAge } = releaseInfo(d);
  return {
    tmdbId: d.id,
    imdbId: d.imdb_id || null,
    title: d.title,
    originalTitle: d.original_title || null,
    year,
    runtime,
    genres,
    originalLanguage: d.original_language || "en",
    spokenLanguages: Array.isArray(d.spoken_languages) ? d.spoken_languages.map((l) => l.iso_639_1).filter(Boolean) : [],
    overview: d.overview,
    rating,
    votes: typeof d.vote_count === "number" ? d.vote_count : 0,
    popularity: typeof d.popularity === "number" ? d.popularity : null,
    posterPath: d.poster_path || null,
    certificate: certificate || null,
    minAge,
    keywords,
    productionCountries: Array.isArray(d.production_countries) ? d.production_countries.map((c) => c.iso_3166_1).filter(Boolean) : [],
  };
}

function canonGenre(g) {
  return g === "Science Fiction" ? "Sci-Fi" : g;
}

// Discover slices shaped to hit every coverage target (unchanged).
function buildSlices() {
  const slices = [];
  const ERAS = [
    { name: "pre1990", gte: null, lte: "1989-12-31", votes: 5 },
    { name: "mid", gte: "1990-01-01", lte: "2022-12-31", votes: 50 },
    { name: "recent", gte: "2023-01-01", lte: null, votes: 10 },
  ];
  const SORTS = ["popularity.desc", "vote_average.desc"];
  for (const lang of ["en", "hi", "ta", "te", "ko", "ja", "es", "fr"]) {
    for (const era of ERAS) {
      for (const sort of SORTS) {
        slices.push({ key: `lang:${lang}:${era.name}:${sort}`, lang, era, sort, pages: 6, votes: era.votes });
      }
    }
  }
  for (const g of TARGET_GENRES) {
    const id = GENRE_IDS[g === "Sci-Fi" ? "Science Fiction" : g];
    for (const sort of SORTS) {
      slices.push({ key: `genre:${g}:${sort}`, genreId: id, sort, pages: 5, votes: 10 });
    }
  }
  for (const lang of ["en", "hi"]) {
    for (const sort of SORTS) {
      slices.push({ key: `short:${lang}:${sort}`, lang, sort, pages: 5, votes: 5, runtimeLte: 90, runtimeGte: 41 });
    }
  }
  return slices;
}

function sliceParams(s) {
  const p = { include_adult: "false", page: "1", "vote_count.gte": String(s.votes ?? 50) };
  if (s.lang) p.with_original_language = s.lang;
  if (s.genreId) p.with_genres = String(s.genreId);
  if (s.era?.gte) p["primary_release_date.gte"] = s.era.gte;
  if (s.era?.lte) p["primary_release_date.lte"] = s.era.lte;
  if (s.runtimeLte) p["with_runtime.lte"] = String(s.runtimeLte);
  if (s.runtimeGte) p["with_runtime.gte"] = String(s.runtimeGte);
  if (s.sort) p.sort_by = s.sort;
  return p;
}

// Pace + retry state shared by all workers.
let lastStart = 0;
let req429s = 0;

async function pace() {
  const wait = lastStart + MIN_START_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
}

async function tmdb(pathname, params, key) {
  const q = new URLSearchParams({ api_key: key, ...params });
  const url = `https://api.themoviedb.org/3${pathname}?${q.toString()}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    await pace();
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": "MovieNightPicker-ingest/1.0" },
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      throw new Error("NETWORK:" + ((e.cause && (e.cause.code || e.cause.message)) || e.message));
    }
    if (res.status === 429) {
      req429s++;
      const retryAfterSec = Number(res.headers.get("retry-after") || 0);
      await sleep(Math.min(60000, retryAfterSec * 1000 + 1000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error("HTTP:" + res.status);
    return res.json();
  }
  throw new Error("HTTP:429-persistent");
}

const UPSERT_COLS = ["tmdbId", "imdbId", "title", "originalTitle", "year", "runtime",
  "genres", "originalLanguage", "spokenLanguages", "overview", "rating", "votes",
  "popularity", "posterPath", "certificate", "minAge", "keywords", "productionCountries"];

async function upsertBatch(pool, rows) {
  if (rows.length === 0) return;
  const params = [];
  const tuples = rows.map((m) => {
    const vals = [m.tmdbId, m.imdbId, m.title, m.originalTitle, m.year, m.runtime,
      m.genres, m.originalLanguage, m.spokenLanguages, m.overview, m.rating, m.votes,
      m.popularity, m.posterPath, m.certificate, m.minAge, m.keywords, m.productionCountries];
    const base = params.length;
    vals.forEach((v) => params.push(v));
    return `(${vals.map((_, k) => `$${base + k + 1}`).join(",")})`;
  });
  const updates = UPSERT_COLS.slice(1).map((c) => `${c}=EXCLUDED.${c}`).join(",");
  await pool.query(
    `INSERT INTO movies (${UPSERT_COLS.join(",")}) VALUES ${tuples.join(",")} ` +
    `ON CONFLICT (tmdbId) DO UPDATE SET ${updates}, updatedAt=NOW()`,
    params,
  );
}

export async function updateCertBatch(pool, rows) {
  if (rows.length === 0) return 0;
  const { rowCount } = await pool.query(
    `UPDATE movies m SET certificate = v.certificate, minAge = v.minAge, updatedAt = NOW()
     FROM (SELECT unnest($1::int[]) AS tmdbId, unnest($2::text[]) AS certificate,
                  unnest($3::int[]) AS minAge) v
     WHERE m.tmdbId = v.tmdbId`,
    [rows.map((r) => r.tmdbId), rows.map((r) => r.certificate), rows.map((r) => r.minAge)],
  );
  return rowCount ?? 0;
}

/**
 * Backfill mode: re-fetch release_dates for rows where minAge IS NULL and
 * update certificate + minAge. Same pacing/429 handling as ingest.
 * Resumable: finished rows leave the NULL set, so re-running continues
 * where the last run stopped. (Rows with no mappable certificate stay NULL
 * and are re-fetched on the next run.)
 */
async function runBackfill(pool, KEY, limit, pastDeadline) {
  const { rows } = await pool.query("SELECT tmdbId, certificate FROM movies WHERE minAge IS NULL ORDER BY tmdbId");
  const stored = new Map(rows.map((r) => [r.tmdbid, r.certificate]));
  const allIds = pgIds(rows);
  const ids = limit > 0 ? allIds.slice(0, limit) : allIds;
  console.log(`backfill-cert: ${ids.length} rows with minAge NULL`);
  let fetched = 0;
  let updated = 0;
  let noCert = 0;
  let stoppedEarly = false;
  let aborted = false;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    if (pastDeadline()) { stoppedEarly = true; break; }
    const batch = ids.slice(i, i + BATCH_SIZE);
    const out = [];
    for (let w = 0; w < batch.length; w += CONCURRENCY) {
      if (pastDeadline()) { stoppedEarly = true; break; }
      const chunk = batch.slice(w, w + CONCURRENCY);
      const results = await Promise.all(chunk.map(async (id) => {
        fetched++;
        try {
          const d = await tmdb(`/movie/${id}`, { append_to_response: "release_dates" }, KEY);
          const info = releaseInfo(d);
          if (!info.certificate) {
            // TMDB had no usable certification: fall back to the stored one.
            const fb = storedCertAge(stored.get(id));
            noCert++;
            if (fb) return { tmdbId: id, certificate: fb.certificate, minAge: fb.minAge };
          }
          // shortcut: rows with nothing mappable stay NULL and are re-fetched
          // next run; upgrade by persisting an attempted-at marker to skip them.
          return { tmdbId: id, certificate: info.certificate || null, minAge: info.minAge };
        } catch (e) {
          if (!String(e.message).startsWith("HTTP:")) throw e;
          return null;
        }
      }));
      for (const r of results) if (r) out.push(r);
    }
    let batchUpdated = 0;
    if (out.length > 0) {
      batchUpdated = await updateCertBatch(pool, out);
      updated += batchUpdated;
    }
    console.log(`backfill: updated=${updated} noCert=${noCert} fetched=${fetched} 429s=${req429s}`);
    if (batch.length === BATCH_SIZE && batchUpdated === 0) {
      console.log(`backfill ABORTED: full batch of ${BATCH_SIZE} produced 0 updates (UPDATEs matching nothing, or every detail fetch failing) — fix before re-running`);
      process.exitCode = 1;
      aborted = true;
      break;
    }
  }
  console.log(`backfill done: updated=${updated} noCert=${noCert} fetched=${fetched} 429s=${req429s}` +
    (aborted ? " (ABORTED, see above)" : "") +
    (stoppedEarly ? " (stopped early: approaching job timeout, progress saved)" : ""));
}

/** Missing/non-numeric counts are UNMET, never met. Pure for testing. */
export function coverageUnmet(c) {
  const bad = (v) => typeof v !== "number" || !Number.isFinite(v);
  const show = (v) => (bad(v) ? "MISSING" : String(v));
  const unmet = [];
  if (bad(c.total) || c.total < TARGET_TOTAL) unmet.push(`total ${show(c.total)}<${TARGET_TOTAL}`);
  const lang = c.byLang || {};
  for (const [l, n] of Object.entries(TARGET_LANGS)) {
    if (bad(lang[l]) || lang[l] < n) unmet.push(`${l} ${show(lang[l])}<${n}`);
  }
  if (bad(lang.en) || lang.en < TARGET_EN) unmet.push(`en ${show(lang.en)}<${TARGET_EN}`);
  const genre = c.byGenre || {};
  for (const g of TARGET_GENRES) {
    if (bad(genre[g]) || genre[g] < 150) unmet.push(`${g} ${show(genre[g])}<150`);
  }
  if (bad(c.pre1990) || c.pre1990 < TARGET_PRE1990) unmet.push(`pre1990 ${show(c.pre1990)}<${TARGET_PRE1990}`);
  if (bad(c.recent) || c.recent < TARGET_RECENT) unmet.push(`recent ${show(c.recent)}<${TARGET_RECENT}`);
  if (bad(c.shortEn) || c.shortEn < TARGET_SHORT_EN) unmet.push(`shortEn ${show(c.shortEn)}<${TARGET_SHORT_EN}`);
  if (bad(c.shortHi) || c.shortHi < TARGET_SHORT_HI) unmet.push(`shortHi ${show(c.shortHi)}<${TARGET_SHORT_HI}`);
  return unmet;
}

async function report(pool) {
  const q = (text, params) => pool.query(text, params).then((r) => r.rows);
  // One query for every scalar (aliases stay lowercase: pg folds unquoted names).
  const [s] = await q(
    `SELECT count(*)::int AS total,
      count(*) FILTER (WHERE minAge IS NOT NULL)::int AS withage,
      count(*) FILTER (WHERE imdbId IS NOT NULL)::int AS withimdb,
      count(*) FILTER (WHERE year < 1990)::int AS pre1990,
      count(*) FILTER (WHERE year >= 2023)::int AS recent,
      count(*) FILTER (WHERE originalLanguage='en' AND runtime < 90)::int AS shorten,
      count(*) FILTER (WHERE originalLanguage='hi' AND runtime < 90)::int AS shorthi
     FROM movies`);
  const langRows = await q(
    "SELECT originalLanguage AS lang, count(*)::int AS n FROM movies GROUP BY 1 ORDER BY 2 DESC");
  const genreRows = await q(
    "SELECT g AS genre, count(*)::int AS n FROM movies, unnest(genres) g GROUP BY 1 ORDER BY 2 DESC");
  const counts = {
    total: s.total, withAge: s.withage, withImdb: s.withimdb,
    pre1990: s.pre1990, recent: s.recent, shortEn: s.shorten, shortHi: s.shorthi,
    byLang: Object.fromEntries(langRows.map((r) => [r.lang, r.n])),
    byGenre: Object.fromEntries(genreRows.map((r) => [canonGenre(r.genre), r.n])),
  };
  const show = (v) => (typeof v !== "number" || !Number.isFinite(v) ? "MISSING" : String(v));

  console.log("---- coverage (from database) ----");
  console.log(`total=${show(counts.total)}`);
  console.log("lang:  " + ["en", ...Object.keys(TARGET_LANGS)].map((l) => {
    const n = counts.byLang[l];
    const need = l === "en" ? TARGET_EN : TARGET_LANGS[l];
    return `${l}=${show(n)}${typeof n === "number" && n >= need ? "" : " SHORT"}`;
  }).join(" "));
  console.log("genre: " + TARGET_GENRES.map((g) =>
    `${g}=${show(counts.byGenre[g])}${typeof counts.byGenre[g] === "number" && counts.byGenre[g] >= 150 ? "" : " SHORT"}`).join(" "));
  console.log(`era:   pre1990=${show(counts.pre1990)} recent2023+=${show(counts.recent)} shortEn=${show(counts.shortEn)} shortHi=${show(counts.shortHi)}`);
  console.log(`share: minAge=${show(counts.withAge)}/${show(counts.total)} imdbId=${show(counts.withImdb)}/${show(counts.total)} shortHi=${show(counts.shortHi)}`);
  const unmet = coverageUnmet(counts);
  if (unmet.length > 0) console.log("UNMET: " + unmet.join("; "));
  else console.log("all coverage targets met");
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const mode = parseMode(process.argv.slice(2));
  const env = loadEnv();
  const KEY = env.TMDB_API_KEY;
  if (!KEY) {
    console.log("TMDB_API_KEY is not set (checked env + .env). Nothing ingested.");
    process.exit(3);
  }
  if (!env.DATABASE_URL) {
    console.log("DATABASE_URL is not set (checked env + .env). Nothing ingested.");
    process.exit(3);
  }

  // Preflight: fail fast with a clear message when TMDB is unreachable.
  try {
    await tmdb("/discover/movie", { page: "1" }, KEY);
  } catch (e) {
    console.log("TMDB is unreachable from this machine (" + e.message + ").");
    console.log("Turn the VPN on, then re-run: npm run ingest:tmdb");
    process.exit(3);
  }

  const jobTimeoutMin = Number(env.JOB_TIMEOUT_MINUTES || 340);
  const deadline = Date.now() + Math.max(1, jobTimeoutMin - STOP_EARLY_MIN) * 60 * 1000;
  const pastDeadline = () => Date.now() > deadline;

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    if (mode === "backfill-cert") {
      await runBackfill(pool, KEY, limit, pastDeadline);
      await report(pool);
      return;
    }
    const existing = await pool.query("SELECT tmdbId FROM movies").then((r) => r.rows);
    const seen = new Set(pgIds(existing));
    console.log(`database already holds ${seen.size} tmdbIds, skipping those`);

    let detailCalls = 0;
    let upserted = 0;
    let stoppedEarly = false;
    const slices = buildSlices();

    const fetchDetail = async (id) => {
      const d = await tmdb(`/movie/${id}`, { append_to_response: "release_dates,keywords" }, KEY);
      return keepMovie(d);
    };

    outer:
    for (const s of slices) {
      const params = sliceParams(s);
      for (let page = 1; page <= s.pages; page++) {
        if (pastDeadline()) { stoppedEarly = true; break outer; }
        let data;
        try {
          data = await tmdb("/discover/movie", { ...params, page: String(page) }, KEY);
        } catch (e) {
          console.log(`slice ${s.key} page ${page} failed (${e.message}), continuing`);
          continue;
        }
        const ids = (data.results || []).map((r) => r.id).filter((id) => !seen.has(id));
        ids.forEach((id) => seen.add(id)); // claim: no duplicate fetches
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          if (pastDeadline()) { stoppedEarly = true; break outer; }
          if (limit > 0 && detailCalls >= limit) break outer;
          if (detailCalls >= MAX_DETAILS) break outer;
          const batchIds = ids.slice(i, i + BATCH_SIZE).filter(() => limit === 0 || detailCalls < limit);
          // Modest concurrency: CONCURRENCY workers, globally paced to ~12 req/s.
          const kept = [];
          for (let w = 0; w < batchIds.length; w += CONCURRENCY) {
            if (pastDeadline()) { stoppedEarly = true; break outer; }
            const chunk = batchIds.slice(w, w + CONCURRENCY);
            const results = await Promise.all(chunk.map(async (id) => {
              detailCalls++;
              try {
                return await fetchDetail(id);
              } catch (e) {
                if (!String(e.message).startsWith("HTTP:")) throw e;
                return null;
              }
            }));
            for (const m of results) if (m) kept.push(m);
          }
          if (kept.length > 0) {
            await upsertBatch(pool, kept);
            upserted += kept.length;
          }
          console.log(`after ${s.key} p${page}: kept=${kept.length} upserted=${upserted} details=${detailCalls} 429s=${req429s}`);
        }
        if (page >= (data.total_pages || 1)) break;
      }
      if (limit > 0 && detailCalls >= limit) break;
      if (detailCalls >= MAX_DETAILS) break;
    }

    console.log(`ingest done: upserted=${upserted} details=${detailCalls} 429s=${req429s}` +
      (stoppedEarly ? " (stopped early: approaching job timeout, progress saved)" : "") +
      (limit > 0 && detailCalls >= limit ? ` (limit ${limit} reached)` : ""));
    await report(pool);
    // Exit 0 whenever the run completed safely: data is in the DB and the
    // report above shows which coverage targets (if any) are still unmet.
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] &&
  path.basename(process.argv[1]) === "ingest-tmdb.mjs";
if (invokedDirectly) await main();
