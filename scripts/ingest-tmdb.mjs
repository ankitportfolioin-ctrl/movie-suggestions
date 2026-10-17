/**
 * TMDB global ingest: upserts movies straight into Postgres (>=3000 movies
 * covering every genre, language and era the recommender must serve).
 *
 * Usage: npm run ingest:tmdb [-- --limit N] [--mode ingest|backfill-cert] [--force]
 *        [--dry-run] [--years 2000-2026] [--types movie,short,series]
 *   --limit N caps NEW detail fetches this run (default 0 = no limit).
 *   --dry-run counts new ids per type/year/language with discover calls only
 *     (quality rule applied) and estimates detail calls + runtime. Writes nothing.
 *   --years / --types pick the slice window for dry-run and ingest.
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
  if (key === "A") return null; // MX all-ages vs IN adult: country unknown
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
// No bare "A": MX all-audiences vs IN adult-only is country-dependent.
const ALL_AGES = new Set(["G", "U", "L", "AA", "AL", "T", "SU", "LIVRE", "ALL", "GENEL", "BTL", "APT", "APTA", "BO", "E", "C", "OA", "UC", "TUTTI", "Tutti"]);

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

const ALLOWED_AGES = [0, 6, 12, 16, 18];

// Snap a median up to the nearest allowed age (conservative for maturity).
function snapUp(v) {
  for (const t of ALLOWED_AGES) if (v <= t) return t;
  return 18;
}

/**
 * Read release_dates for ALL countries. Per country keeps the highest mapped
 * age ("A" maps per country: MX 0 vs IN 18). Returns the raw cert of the
 * strictest entry (legacy `certificate`), the median age across countries
 * (floored at 16 when US/GB/DE says 16+), the strictest age, the count of
 * countries at 18, and the per-country raw certs.
 */
export function releaseAges(details) {
  const results = (details.release_dates && details.release_dates.results) || [];
  const byCountry = new Map();
  let strictCert = "";
  let strictAge = null;
  for (const entry of results) {
    const iso = entry.iso_3166_1;
    for (const r of entry.release_dates || []) {
      const raw = (r.certification || "").trim();
      if (!raw) continue;
      const age = certToMinAge(iso, raw);
      if (age === null) continue;
      const cur = byCountry.get(iso);
      if (!cur || age > cur.age) byCountry.set(iso, { age, cert: raw });
      if (strictAge === null || age > strictAge) { strictAge = age; strictCert = raw; }
    }
  }
  const certByCountry = {};
  const ages = [];
  for (const [iso, v] of byCountry) { certByCountry[iso] = v.cert; ages.push(v.age); }
  if (ages.length === 0) {
    return { certificate: "", minAge: null, minAgeStrict: null, adultVotes: 0, certByCountry };
  }
  ages.sort((a, b) => a - b);
  const mid = Math.floor(ages.length / 2);
  const median = ages.length % 2 ? ages[mid] : (ages[mid - 1] + ages[mid]) / 2;
  let minAge = snapUp(median);
  for (const iso of ["US", "GB", "DE"]) {
    const v = byCountry.get(iso);
    if (v && v.age >= 16 && minAge < 16) minAge = 16;
  }
  return {
    certificate: strictCert,
    minAge,
    minAgeStrict: ages[ages.length - 1],
    adultVotes: ages.filter((a) => a === 18).length,
    certByCountry,
  };
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
  const info = releaseAges(d);
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
    certificate: info.certificate || null,
    minAge: info.minAge,
    minAgeStrict: info.minAgeStrict,
    adultVotes: info.adultVotes,
    certByCountry: Object.keys(info.certByCountry).length > 0 ? JSON.stringify(info.certByCountry) : null,
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
  "popularity", "posterPath", "certificate", "minAge", "minAgeStrict", "adultVotes",
  "certByCountry", "keywords", "productionCountries"];

async function upsertBatch(pool, rows) {
  if (rows.length === 0) return;
  const params = [];
  const tuples = rows.map((m) => {
    const vals = [m.tmdbId, m.imdbId, m.title, m.originalTitle, m.year, m.runtime,
      m.genres, m.originalLanguage, m.spokenLanguages, m.overview, m.rating, m.votes,
      m.popularity, m.posterPath, m.certificate, m.minAge, m.minAgeStrict ?? null,
      m.adultVotes ?? null, m.certByCountry ?? null, m.keywords, m.productionCountries];
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
    `UPDATE movies m SET certificate = v.certificate, minAge = v.minAge,
       minAgeStrict = v.minAgeStrict, adultVotes = v.adultVotes,
       certByCountry = v.ccb::jsonb, updatedAt = NOW()
     FROM (SELECT unnest($1::int[]) AS tmdbId, unnest($2::text[]) AS certificate,
                  unnest($3::int[]) AS minAge, unnest($4::int[]) AS minAgeStrict,
                  unnest($5::int[]) AS adultVotes, unnest($6::text[]) AS ccb) v
     WHERE m.tmdbId = v.tmdbId`,
    [rows.map((r) => r.tmdbId), rows.map((r) => r.certificate),
     rows.map((r) => r.minAge), rows.map((r) => r.minAgeStrict ?? null),
     rows.map((r) => r.adultVotes ?? null), rows.map((r) => r.certByCountry ?? null)],
  );
  return rowCount ?? 0;
}

/**
 * Backfill mode: re-fetch release_dates and update certificate + minAge +
 * minAgeStrict + adultVotes + certByCountry. Same pacing/429 handling.
 * Default selects rows where minAge IS NULL; --force selects everything
 * still missing certByCountry (reprocesses legacy rows). Resumable: finished
 * rows leave the selected set, so re-running continues where it stopped.
 * (Rows with no mappable certificate stay NULL and are re-fetched next run.)
 */
async function runBackfill(pool, KEY, limit, pastDeadline, force) {
  const { rows } = force
    ? await pool.query("SELECT tmdbId, certificate FROM movies WHERE certByCountry IS NULL ORDER BY tmdbId")
    : await pool.query("SELECT tmdbId, certificate FROM movies WHERE minAge IS NULL ORDER BY tmdbId");
  const stored = new Map(rows.map((r) => [r.tmdbid, r.certificate]));
  const allIds = pgIds(rows);
  const ids = limit > 0 ? allIds.slice(0, limit) : allIds;
  console.log(`backfill-cert${force ? " --force" : ""}: ${ids.length} rows to process`);
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
          const info = releaseAges(d);
          if (!info.certificate) {
            // TMDB had no usable certification: fall back to the stored one.
            const fb = storedCertAge(stored.get(id));
            noCert++;
            if (fb) {
              return { tmdbId: id, certificate: fb.certificate, minAge: fb.minAge,
                minAgeStrict: fb.minAge, adultVotes: fb.minAge === 18 ? 1 : 0, certByCountry: null };
            }
          }
          // shortcut: rows with nothing mappable stay NULL and are re-fetched
          // next run; upgrade by persisting an attempted-at marker to skip them.
          return { tmdbId: id, certificate: info.certificate || null, minAge: info.minAge,
            minAgeStrict: info.minAgeStrict, adultVotes: info.adultVotes,
            certByCountry: Object.keys(info.certByCountry).length > 0
              ? JSON.stringify(info.certByCountry) : null };
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

// ---- Dry-run counting (discover calls only; never writes a row) ----
//
// Slices per type: year, original language (BIG_LANGS + implicit catch-all —
// TMDB has no "language not in" filter, so the year/genre families cover the
// rest) and genre, each in two sort orders. Depth <= 25 pages per slice,
// stopping as soon as a page adds no id that is not already counted.

/** Languages the user named as "big": vote floor 100. Everything else: 20. */
export const BIG_LANGS = ["en", "hi", "ta", "te", "ml", "kn", "bn", "mr", "pa", "ko",
  "ja", "zh", "es", "fr", "de", "it", "pt", "ru", "tr", "ar", "th", "id", "fa", "pl", "nl", "sv"];

// TMDB TV genre ids (four differ from the movie ids).
export const TV_GENRE_IDS = {
  "Action & Adventure": 10759, Animation: 16, Comedy: 35, Crime: 80,
  Documentary: 99, Drama: 18, Family: 10751, Kids: 10762, Mystery: 9648,
  News: 10763, Reality: 10764, "Sci-Fi & Fantasy": 10765, Soap: 10766,
  Talk: 10767, "War & Politics": 10768, Western: 37,
};

export const DRY_SORTS = ["popularity.desc", "vote_average.desc"];
export const DRY_MAX_PAGES = 25;

/** Vote floor: 100 big languages, 20 others, 5 for shorts and web series. */
export function voteFloor(type, lang, web = false) {
  if (type === "short" || (type === "series" && web)) return 5;
  return BIG_LANGS.includes(lang) ? 100 : 20;
}

/**
 * Discover-level quality rule (fields available before any detail call):
 * has overview, has poster, has a rating, not adult, votes >= floor.
 * Web-series status needs /tv detail, so series use the non-web floor here.
 */
export function dryRunQuality(row, type, lang) {
  if (!row || row.adult === true) return false;
  if (!row.overview || !row.poster_path) return false;
  if (!(typeof row.vote_average === "number" && row.vote_average > 0)) return false;
  return (typeof row.vote_count === "number" ? row.vote_count : 0) >= voteFloor(type, lang);
}

/** "--years 2000-2026" (or a single year) -> { from, to }. */
export function parseYears(value) {
  const m = String(value ?? "").match(/^(\d{4})(?:-(\d{4}))?$/);
  if (!m) throw new Error("usage: --years 2000-2026");
  const from = Number(m[1]);
  const to = Number(m[2] ?? m[1]);
  if (to < from) throw new Error("usage: --years FROM-TO with TO >= FROM");
  return { from, to };
}

/** "--types movie,short,series" -> deduped list of known kinds. */
export function parseTypesArg(value) {
  const list = [...new Set(String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (list.length === 0 || list.some((t) => !["movie", "short", "series"].includes(t))) {
    throw new Error("usage: --types movie,short,series");
  }
  return list;
}

function argValue(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(new RegExp(`^${name}(?:=(.+))?$`));
    if (m) return m[1] !== undefined ? m[1] : argv[i + 1];
  }
  return undefined;
}

/** Slice list for one dry-run scan (pure; tested). */
export function buildDryRunSlices(types, fromYear, toYear) {
  const slices = [];
  const forType = (type, path, genres) => {
    const yearKey = type === "series" ? "first_air_date_year" : "primary_release_year";
    const rangeGte = type === "series" ? "first_air_date.gte" : "primary_release_date.gte";
    const rangeLte = type === "series" ? "first_air_date.lte" : "primary_release_date.lte";
    // Discover-level stand-in for the stored `type` column: shorts 1-40 min,
    // features 41+ (both live on /discover/movie). Series need no runtime filter.
    const runtime = type === "short" ? { "with_runtime.gte": "1", "with_runtime.lte": "40" }
      : type === "movie" ? { "with_runtime.gte": "41" } : {};
    for (let y = fromYear; y <= toYear; y++) {
      for (const sort of DRY_SORTS) {
        slices.push({ key: `${type}:year:${y}:${sort}`, type, path,
          params: { [yearKey]: String(y), sort_by: sort, ...runtime } });
      }
    }
    for (const lang of BIG_LANGS) {
      for (const sort of DRY_SORTS) {
        slices.push({ key: `${type}:lang:${lang}:${sort}`, type, path,
          params: { with_original_language: lang, [rangeGte]: `${fromYear}-01-01`,
            [rangeLte]: `${toYear}-12-31`, sort_by: sort, ...runtime } });
      }
    }
    for (const [name, id] of Object.entries(genres)) {
      for (const sort of DRY_SORTS) {
        slices.push({ key: `${type}:genre:${name}:${sort}`, type, path,
          params: { with_genres: String(id), [rangeGte]: `${fromYear}-01-01`,
            [rangeLte]: `${toYear}-12-31`, sort_by: sort, ...runtime } });
      }
    }
  };
  if (types.includes("movie")) forType("movie", "/discover/movie", GENRE_IDS);
  if (types.includes("short")) forType("short", "/discover/movie", GENRE_IDS);
  if (types.includes("series")) forType("series", "/discover/tv", TV_GENRE_IDS);
  return slices;
}

/**
 * Walk every slice and count NEW ids (not in `seen`) that pass the quality
 * rule; `getPage(pathname, params)` is injected so tests run offline.
 * One DB id counts once even when many slices show it.
 * @param {(pathname: string, params: Record<string, string>) => Promise<any>} getPage
 * @param {{types: string[], fromYear: number, toYear: number, seen: Set<number>,
 *   pastDeadline?: () => boolean, log?: (line: string) => void,
 *   slices?: Array<{key: string, type: string, path: string, params: Record<string, string>}> | null}} opts
 */
export async function dryRunScan(getPage, { types, fromYear, toYear, seen, pastDeadline = () => false, log = () => {}, slices = null }) {
  const allSlices = slices || buildDryRunSlices(types, fromYear, toYear);
  const found = new Map(); // id -> { type, lang, year }
  const dbIds = new Map(); // id -> type (counted once)
  let discoverCalls = 0;
  let stoppedEarly = false;
  outer:
  for (const s of allSlices) {
    for (let page = 1; page <= DRY_MAX_PAGES; page++) {
      if (pastDeadline()) { stoppedEarly = true; break outer; }
      discoverCalls++;
      let data;
      try {
        data = await getPage(s.path, {
          include_adult: "false", "vote_count.gte": "5", ...s.params, page: String(page),
        });
      } catch (e) {
        log(`slice ${s.key} page ${page} failed (${e.message}), continuing`);
        break;
      }
      const rows = data.results || [];
      let added = 0;
      for (const r of rows) {
        if (!dryRunQuality(r, s.type, r.original_language || "")) continue;
        if (seen.has(r.id)) {
          if (!dbIds.has(r.id)) dbIds.set(r.id, s.type);
          continue;
        }
        if (found.has(r.id)) continue;
        const date = r.release_date || r.first_air_date || "";
        found.set(r.id, {
          type: s.type,
          lang: r.original_language || "other",
          year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
        });
        added++;
      }
      if (added === 0) break; // this page (and the deeper ones) add nothing new
      if (page >= (data.total_pages || 1)) break;
    }
    if (allSlices.indexOf(s) % 25 === 24) {
      log(`progress: slices=${allSlices.indexOf(s) + 1}/${allSlices.length} calls=${discoverCalls} new=${found.size}`);
    }
  }
  return { found, dbIds, discoverCalls, sliceCount: allSlices.length, stoppedEarly };
}

/** Bucket the found ids per type, per year and per language. */
export function dryRunSummary(found) {
  const zero = () => ({ movie: 0, short: 0, series: 0 });
  const byType = zero();
  const byYear = new Map();
  const byLang = new Map();
  for (const v of found) {
    const { type, year, lang } = v[1];
    byType[type] = (byType[type] || 0) + 1;
    const y = byYear.get(year) || zero();
    y[type]++;
    byYear.set(year, y);
    const l = byLang.get(lang) || zero();
    l[type]++;
    byLang.set(lang, l);
  }
  return { byType, byYear, byLang };
}

/** Detail calls + runtime estimate at the shared 12 req/s pacing. */
export function dryRunEstimate(newIds, discoverCalls, rps = 12) {
  const totalCalls = newIds + discoverCalls;
  return { detailCalls: newIds, discoverCalls, totalCalls, seconds: totalCalls / rps };
}

function printDryRunResult(scan, seenSize, elapsedMs) {
  const { byType, byYear, byLang } = dryRunSummary(scan.found);
  const dbByType = { movie: 0, short: 0, series: 0 };
  for (const t of scan.dbIds.values()) dbByType[t]++;
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const langs = [...byLang.entries()].sort((a, b) =>
    (b[1].movie + b[1].short + b[1].series) - (a[1].movie + a[1].short + a[1].series));
  const triple = (o) => `${o.movie}/${o.short}/${o.series}`;
  const est = dryRunEstimate(scan.found.size, scan.discoverCalls);
  const h = Math.floor(est.seconds / 3600);
  const m = Math.round((est.seconds % 3600) / 60);
  console.log("---- dry-run result (discover calls only, nothing written) ----");
  console.log(`slices=${scan.sliceCount} discoverCalls=${scan.discoverCalls} elapsed=${Math.round(elapsedMs / 1000)}s`);
  console.log(`new ids: movie=${byType.movie} short=${byType.short} series=${byType.series} total=${scan.found.size}`);
  console.log(`already in database: movie=${dbByType.movie} short=${dbByType.short} series=${dbByType.series} ` +
    `(rows in table=${seenSize}; a row seen in many slices counts once)`);
  console.log("by year (movie/short/series):");
  for (const y of years) console.log(`  ${y}: ${triple(byYear.get(y))}`);
  console.log("by language (movie/short/series), biggest first:");
  for (const [l, o] of langs) console.log(`  ${l}: ${triple(o)}`);
  console.log(`estimate: detail calls=${est.detailCalls} + discover calls=${est.discoverCalls} = ${est.totalCalls} calls`);
  console.log(`  at 12 req/s -> ${h}h ${m}m (ignoring 429 back-off and DB time)`);
  if (scan.stoppedEarly) console.log("stopped early: approaching job timeout");
}

async function runDryRun(KEY, pool, opts, pastDeadline) {
  const rows = (await pool.query("SELECT tmdbId FROM movies")).rows;
  const seen = new Set(pgIds(rows));
  console.log(`dry-run: years=${opts.fromYear}-${opts.toYear} types=${opts.types.join(",")} ` +
    `pages<=${DRY_MAX_PAGES} sorts=${DRY_SORTS.join(",")}`);
  console.log(`read-only: ${seen.size} tmdbIds already in the database are counted, never written`);
  const t0 = Date.now();
  const scan = await dryRunScan((pathname, params) => tmdb(pathname, params, KEY),
    { ...opts, seen, pastDeadline, log: (line) => console.log(line) });
  printDryRunResult(scan, seen.size, Date.now() - t0);
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
  const argv = process.argv.slice(2);
  const limit = parseLimit(argv);
  const mode = parseMode(argv);
  const dryRun = argv.includes("--dry-run");
  const years = parseYears(argValue(argv, "--years") ?? "2000-2026");
  const types = parseTypesArg(argValue(argv, "--types") ?? (dryRun ? "movie,short,series" : "movie"));
  const force = argv.includes("--force");
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
  if (!dryRun && types.join(",") !== "movie") {
    // Step 3 wires --types short,series into the ingest path.
    console.log(`ingest --types ${types.join(",")}: only movies are wired up so far.`);
    console.log("Use --dry-run to count shorts/series without writing.");
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
    if (dryRun) {
      await runDryRun(KEY, pool, { types, fromYear: years.from, toYear: years.to }, pastDeadline);
      return;
    }
    if (mode === "backfill-cert") {
      await runBackfill(pool, KEY, limit, pastDeadline, force);
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
