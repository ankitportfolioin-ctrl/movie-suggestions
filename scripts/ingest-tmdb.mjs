/**
 * TMDB ingest: builds data/movies.json (>=3000 movies) covering every genre,
 * language and era the recommender must serve. No live TMDB call happens at
 * search time; this script runs offline-ahead (e.g. with VPN on).
 *
 * Usage: npm run ingest:tmdb
 * Reads the v3 key from the TMDB_API_KEY env var (or .env file).
 * Safe to re-run: progress lives in data/ingest-progress.json and every
 * batch is saved before continuing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = path.join(ROOT, "data", "movies.json");
const PROGRESS_FILE = path.join(ROOT, "data", "ingest-progress.json");

// Standard TMDB movie genre ids.
const GENRE_IDS = {
  Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80,
  Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36,
  Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749,
  "Science Fiction": 878, Thriller: 53, War: 10752, Western: 37,
};
const GENRE_NAMES = Object.fromEntries(Object.entries(GENRE_IDS).map(([n, i]) => [i, n]));

// Coverage targets (do not weaken: Step 2A.4).
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
const MAX_DETAILS = 9000; // hard stop on API usage

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

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  } catch {
    return { doneSlices: [], movies: {} };
  }
}

function saveProgress(p) {
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

async function tmdb(pathname, params, key) {
  const q = new URLSearchParams({ api_key: key, ...params });
  const url = `https://api.themoviedb.org/3${pathname}?${q.toString()}`;
  for (let attempt = 0; attempt < 5; attempt++) {
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
      const wait = Math.min(30000, 2000 * 2 ** attempt + Number(res.headers.get("retry-after") || 0) * 1000);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error("HTTP:" + res.status);
    return res.json();
  }
  throw new Error("HTTP:429-persistent");
}

// Discover slices shaped to hit every coverage target.
function buildSlices() {
  const slices = [];
  const ERAS = [
    { name: "pre1990", gte: null, lte: "1989-12-31", votes: 5 },
    { name: "mid", gte: "1990-01-01", lte: "2022-12-31", votes: 50 },
    { name: "recent", gte: "2023-01-01", lte: null, votes: 10 },
  ];
  const SORTS = ["popularity.desc", "vote_average.desc"];
  // Per-language x era coverage (dedupe keeps totals sane).
  for (const lang of ["en", "hi", "ta", "te", "ko", "ja", "es", "fr"]) {
    for (const era of ERAS) {
      for (const sort of SORTS) {
        slices.push({ key: `lang:${lang}:${era.name}:${sort}`, lang, era, sort, pages: 6, votes: era.votes });
      }
    }
  }
  // Per-genre coverage (sparse genres need low vote floors).
  for (const g of TARGET_GENRES) {
    const id = GENRE_IDS[g === "Sci-Fi" ? "Science Fiction" : g];
    for (const sort of SORTS) {
      slices.push({ key: `genre:${g}:${sort}`, genreId: id, sort, pages: 5, votes: 10 });
    }
  }
  // Short films for English + Hindi (<90 min, runtime > 40 to match keeper rule).
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

function certFrom(details) {
  const all = (details.release_dates && details.release_dates.results) || [];
  for (const pref of ["IN", "US"]) {
    const entry = all.find((r) => r.iso_3166_1 === pref);
    const certs = (entry?.release_dates || []).map((r) => (r.certification || "").trim()).filter(Boolean);
    if (certs.length > 0) return certs[0];
  }
  return "";
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
  return {
    tmdbId: d.id,
    imdbId: d.imdb_id || null,
    title: d.title,
    year,
    runtime,
    genres,
    originalLanguage: d.original_language || "en",
    overview: d.overview,
    rating,
    votes: typeof d.vote_count === "number" ? d.vote_count : 0,
    posterPath: d.poster_path || null,
    certificate: certFrom(d),
    keywords,
  };
}

function canonGenre(g) {
  return g === "Science Fiction" ? "Sci-Fi" : g;
}

function coverage(movies) {
  const byGenre = Object.fromEntries(TARGET_GENRES.map((g) => [g, 0]));
  const byLang = { en: 0, hi: 0, ta: 0, te: 0, ko: 0, ja: 0, es: 0, fr: 0 };
  let pre1990 = 0, recent = 0, shortEn = 0, shortHi = 0;
  for (const m of movies) {
    for (const g of m.genres.map(canonGenre)) if (g in byGenre) byGenre[g]++;
    if (m.originalLanguage in byLang) byLang[m.originalLanguage]++;
    if (m.year < 1990) pre1990++;
    if (m.year >= 2023) recent++;
    if (m.runtime < 90 && m.originalLanguage === "en") shortEn++;
    if (m.runtime < 90 && m.originalLanguage === "hi") shortHi++;
  }
  return { byGenre, byLang, pre1990, recent, shortEn, shortHi, total: movies.length };
}

function coverageOk(c) {
  return (
    c.total >= TARGET_TOTAL &&
    Object.entries(TARGET_LANGS).every(([, n], i) => c.byLang[Object.keys(TARGET_LANGS)[i]] >= n) &&
    c.byLang.en >= TARGET_EN &&
    TARGET_GENRES.every((g) => c.byGenre[g] >= 150) &&
    c.pre1990 >= TARGET_PRE1990 &&
    c.recent >= TARGET_RECENT &&
    c.shortEn >= TARGET_SHORT_EN &&
    c.shortHi >= TARGET_SHORT_HI
  );
}

function printCoverage(c) {
  console.log("genre: " + TARGET_GENRES.map((g) => `${g}=${c.byGenre[g]}${c.byGenre[g] >= 150 ? "" : " SHORT"}`).join(" "));
  console.log("lang:  " + Object.entries(c.byLang).map(([l, n]) => {
    const need = l === "en" ? TARGET_EN : TARGET_LANGS[l] ?? 0;
    return `${l}=${n}${n >= need ? "" : " SHORT"}`;
  }).join(" "));
  console.log(`era:   pre1990=${c.pre1990} recent2023+=${c.recent} shortEn=${c.shortEn} shortHi=${c.shortHi} total=${c.total}`);
}

const env = loadEnv();
const KEY = env.TMDB_API_KEY;
if (!KEY) {
  console.log("TMDB_API_KEY is not set (checked env + .env). Nothing ingested.");
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

const progress = loadProgress();
const movies = progress.movies || {};
let detailCalls = 0;
const slices = buildSlices();

for (const s of slices) {
  if (progress.doneSlices.includes(s.key)) continue;
  const params = sliceParams(s);
  for (let page = 1; page <= s.pages; page++) {
    let data;
    try {
      data = await tmdb("/discover/movie", { ...params, page: String(page) }, KEY);
    } catch (e) {
      console.log(`slice ${s.key} page ${page} failed (${e.message}), saved progress, continuing`);
      saveProgress({ doneSlices: progress.doneSlices, movies });
      continue;
    }
    const ids = (data.results || []).map((r) => r.id).filter((id) => !(id in movies));
    for (const id of ids) {
      if (detailCalls >= MAX_DETAILS) break;
      detailCalls++;
      try {
        const d = await tmdb(`/movie/${id}`, { append_to_response: "release_dates,keywords" }, KEY);
        const kept = keepMovie(d);
        if (kept) movies[id] = kept;
      } catch (e) {
        if (String(e.message).startsWith("HTTP:")) continue;
        console.log(`details failed (${e.message}), saved progress, stopping`);
        saveProgress({ doneSlices: progress.doneSlices, movies });
        process.exit(3);
      }
      await sleep(250); // stay under ~40 req/10s alongside discover calls
      if (Object.keys(movies).length % 20 === 0) saveProgress({ doneSlices: progress.doneSlices, movies });
    }
    if (detailCalls >= MAX_DETAILS) break;
    if (page >= (data.total_pages || 1)) break;
    await sleep(250);
  }
  progress.doneSlices.push(s.key);
  saveProgress({ doneSlices: progress.doneSlices, movies });
  if (detailCalls >= MAX_DETAILS) break;
  const live = coverage(Object.values(movies));
  console.log(`after ${s.key}: kept=${live.total} details=${detailCalls}`);
  if (coverageOk(live)) break; // targets met, stop spending API calls
}

const list = Object.values(movies);
const cov = coverage(list);
console.log("---- coverage ----");
printCoverage(cov);
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(list));
const mb = (fs.statSync(OUT_FILE).size / 1048576).toFixed(1);
console.log(`wrote ${OUT_FILE} (${mb} MB, ${list.length} movies)`);
if (!coverageOk(cov)) {
  console.log("COVERAGE TARGETS NOT MET — re-run to continue, or widen slices. data/movies.json still written.");
  process.exit(2);
}
