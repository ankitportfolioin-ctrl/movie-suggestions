// Vercel serverless entry point
import { fileURLToPath } from 'url';
import path from 'path';
import { randomUUID } from 'node:crypto';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import {
  getRecommendationsWithOMDb,
  LANGUAGE_CODES,
  type MoviePick,
} from '../server/omdb.js';
import { MovieItem } from '../server/catalog.js';
import { loadDbCandidates, loadReferenceAnchors, rankGateMovies, ensureMinAge, diagnoseEmptyPool } from '../server/dbMovies.js';
import type { DbFilters, DbItem } from '../server/dbMovies.js';
import { discoverCandidates, enrichRuntimes } from '../server/discovery.js';
import { validateRecommendBody } from '../server/validate.js';
import { registerAnalyticsRoutes } from '../server/analytics.js';
import { enforceHardConstraints } from '../server/gate.js';
import { runtimeCap } from '../server/omdb.js';
import { enhanceWithGemini } from '../server/ai.js';
import { attachLiveProviders } from '../server/watchmode.js';
import {
  FALLBACK_PNG,
  contentTypeFor,
  fetchUpstream,
  isValidImgHost,
  isValidImgPath,
  isValidImgSize,
  readCached,
  toLocalImg,
  writeCached,
} from '../server/img.js';

// Learning module loaded dynamically to avoid better-sqlite3 on Vercel
let learningModule: any = null;
const LEARNING_ENABLED = process.env.LEARNING_ENABLED === 'true';

async function loadLearningModule() {
  if (!LEARNING_ENABLED) return null;
  if (!learningModule) {
    try {
      learningModule = await import('../server/learning.js');
    } catch (e) {
      console.warn('Learning module unavailable (likely better-sqlite3 not supported):', e);
      return null;
    }
  }
  return learningModule;
}

dotenv.config();

const app = express();

// Security Headers
const isProd = process.env.NODE_ENV === 'production';
app.use(helmet({ contentSecurityPolicy: isProd ? undefined : false }));

// Same-origin only: the client is served by this server, no CORS needed.
app.use(express.json({ limit: '50kb' }));

// In-memory rate limiting: 30 requests per 10 minutes per IP
interface RateLimitEntry {
  count: number;
  resetTime: number;
}
const rateLimits = new Map<string, RateLimitEntry>();
// In-memory rate limiting: 30 requests per 10 minutes per IP.
// shortcut: test-only override via RATE_LIMIT_MAX_REQUESTS (E2E sets it high so
// parallel workers on one IP don't trip the limiter). Production default unchanged.
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = Math.max(1, parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30', 10) || 30);

function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = req.socket.remoteAddress || (Array.isArray(forwarded) ? forwarded[0] : forwarded) || 'unknown';
  const now = Date.now();

  if (rateLimits.size > 1000) {
    for (const [k, v] of rateLimits) if (v.resetTime <= now) rateLimits.delete(k);
  }

  const entry = rateLimits.get(ip);
  if (!entry || entry.resetTime <= now) {
    rateLimits.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }

  if (entry.count >= MAX_REQUESTS) {
    res.status(429).json({ error: 'Too many searches, try again in a few minutes.' });
    return;
  }

  entry.count += 1;
  next();
}

// Learning store (Step 1): signed impressions + feedback events + priors.
// Disabled entirely when LEARNING_ENABLED=false or module unavailable.
let learningDb: any = null;
let eventBursts = new Map<string, any>();

// Initialize learning lazily on first request
async function initLearning() {
  if (learningDb !== null) return; // already attempted
  const mod = await loadLearningModule();
  if (mod) {
    learningDb = mod.openLearningDb();
    eventBursts = new Map();
  } else {
    learningDb = false; // mark as unavailable
  }
}

// Configuration Constants
export const AI_ENABLED = true;

// Health Check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Title Search Endpoint (for reference movie chips)
const titleSearchCache = new Map<string, { data: any; expiresAt: number }>();
const TITLE_SEARCH_TTL = 60 * 60 * 1000; // 1 hour

// Exact Title Search Endpoint (logic in server/titleSearch.ts: provider
// outage is a retryable 502, never a masked empty result).
app.get('/api/search-title', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { searchTitles } = await import('../server/titleSearch.js');
    const { status, body } = await searchTitles(req.query.q, {
      tmdbKey: process.env.TMDB_API_KEY?.trim(),
    });
    res.status(status).json(body);
  } catch (err) {
    console.error('Title search error:', err);
    res.status(502).json({ error: 'Title search is temporarily unavailable. Please try again.', retryable: true });
  }
});

// Title Search Endpoint (for reference movie chips; core in server/titleSearch.ts).
// OMDb search so every suggestion carries a real IMDb id the reference
// pipeline can resolve to a plot; outage stays a retryable error.
app.get('/api/title-search', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { searchSuggestions } = await import('../server/titleSearch.js');
    const safeQuery = String(req.query.q || '').replace(/<[^>]*>/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

    const now = Date.now();
    const cached = titleSearchCache.get(safeQuery);
    if (cached && cached.expiresAt > now) {
      res.json({ results: cached.data });
      return;
    }

    const { status, body } = await searchSuggestions(safeQuery, {
      omdbKey: process.env.OMDB_API_KEY?.trim(),
    });
    if (status !== 200) {
      res.status(status).json(body);
      return;
    }
    const results = body.results as unknown[];
    titleSearchCache.set(safeQuery, { data: results, expiresAt: now + TITLE_SEARCH_TTL });
    res.json({ results });
  } catch {
    res.status(502).json({ error: 'Title search is temporarily unavailable. Please try again.', retryable: true });
  }
});

// Natural language search endpoint (shared pipeline with server.ts)
app.post('/api/search', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { query, excludeIds } = req.body || {};
    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      res.status(400).json({ error: 'Invalid query' });
      return;
    }

    // Parse the natural language query into structured params
    const { parseNote } = await import('../server/noteParser.js');
    const note = parseNote(query);

    // Build recommendation params from parsed note
    const mood = note.moods[0] || 'Relaxed';
    const genres = note.genres.length > 0 ? note.genres : ['Surprise me'];
    const audience: string = 'Just me';
    // Explicit bounds win; bare "long" is a minimum (150+ min), never a cap.
    const maxRuntime = note.runtimeHint === 'short' ? 'Under 90 min' : '';
    const languages = note.languageHints.length > 0 ? note.languageHints : ['Any'];
    const preferences = {
      highlyRated: note.wantsHighlyRated || false,
      hiddenGems: false,
      recent: note.eraHint === 'recent',
      classics: note.eraHint === 'classics',
      mature: false,
    };
    const excludeGenres = note.excludeGenres;

    if (note.contradiction) {
      res.json({
        movies: [],
        parsed: { mood, genres, excludeGenres, runtimeHint: note.runtimeHint, languageHints: note.languageHints, eraHint: note.eraHint },
        notices: [note.contradiction],
      });
      return;
    }

    // One shared pipeline: Postgres candidates -> ranking.ts -> gate last.
    const { runtimeCap, LANGUAGE_CODES, MOOD_GENRES, normalizeTitle } = await import('../server/omdb.js');
    const maxMinutes = note.runtimeMaxMinutes ?? runtimeCap(maxRuntime);
    const langCodes = languages.includes('Any')
      ? []
      : languages.map((l: string) => LANGUAGE_CODES[l]).filter(Boolean);
    const currentYear = new Date().getFullYear();
    const wantedGenres = genres.filter((g: string) => g !== 'Surprise me');
    const moodGenreList = MOOD_GENRES[mood] || ['Comedy', 'Adventure'];
    const quizGenres = genres.includes('Surprise me') ? moodGenreList : wantedGenres;

    const filters: DbFilters = {
      // NL search is movies-only until the note names a kind (Step 5 wires it).
      types: ['movie'],
      genres: wantedGenres, excludeGenres, languages: langCodes,
      runtimeMin: note.runtimeMinMinutes ?? null,
      runtimeMax: Number.isFinite(maxMinutes) ? maxMinutes : null,
      yearMin: note.yearMin ?? (preferences.recent ? currentYear - 5 : null),
      yearMax: note.yearMax ?? (preferences.classics ? 1999 : null),
      ratingFloor: preferences.highlyRated ? 7.0 : null,
      seasonsMax: null,
      audience, matureAllowed: false,
      excludeIds: (excludeIds || []).map(Number).filter(Number.isFinite),
      limit: 500,
    };
    const { items } = await loadDbCandidates(filters);
    // Reference titles from the note ("like Arrival"): anchored on their own
    // verified overviews, excluded from the picks. Unloadable refs are
    // disclosed, never silently ignored.
    const referencedFilms = new Map<number, DbItem>();
    for (const m of items) {
      if (note.referenceTitles.includes(normalizeTitle(m.title))) referencedFilms.set(m.id, m);
    }
    if (note.referenceTitles.length > 0) {
      for (const m of await loadReferenceAnchors(note.referenceTitleNames)) {
        referencedFilms.set(m.id, m);
      }
    }
    const themeRefs = [...referencedFilms.values()].map((m) => m.overview).filter((o) => o.length > 0);
    const candidates = items.filter((m) => !referencedFilms.has(m.id));
    const { movies: ranked, relaxed } = rankGateMovies(candidates, {
      quizGenres, noteGenres: [], moodGenres: moodGenreList, mood, themeRefs,
      maxMinutes, languageSpecific: langCodes.length > 0,
      preferHiddenGems: false, mentionedTitles: note.lovedTitles,
    }, {
      maxMinutes, maxRuntimeLabel: maxRuntime, langCodes,
      highlyRated: preferences.highlyRated, recent: preferences.recent,
      classics: preferences.classics, audience, matureAllowed: false,
      types: ['movie'], seasonsMax: null,
    }, 3);
    const { movies: picks, notices: ageNotices } = await ensureMinAge(ranked, audience, false);
    const notices = [...(excludeGenres.length > 0 ? [`Excluding ${excludeGenres.join(', ')}`] : []), ...relaxed, ...ageNotices];
    if (note.referenceTitleNames.length > 0) {
      notices.push(
        themeRefs.length > 0
          ? `Using ${note.referenceTitleNames.join(', ')} as your similarity reference.`
          : `Couldn't load ${note.referenceTitleNames.join(', ')} for similarity matching — these picks use your other filters instead.`
      );
    }
    if (picks.length === 0) {
      const cause = await diagnoseEmptyPool(filters).catch(() => null);
      notices.push(cause ?? 'Nothing matches all of those filters together — try removing one constraint.');
    }
    // Reason comes from the rank features (never a mood template).
    const top3 = picks;

    res.json({ 
      movies: top3, 
      parsed: { mood, genres, excludeGenres, runtimeHint: note.runtimeHint, languageHints: note.languageHints, eraHint: note.eraHint },
      notices,
    });
  } catch (err) {
    console.error('Natural language search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Artwork proxy: GET /img/:size/:host/:path* (E11)
app.get('/img/:size/:host/*', async (req: Request, res: Response) => {
  try {
    const size = String(req.params.size || '');
    const host = String(req.params.host || '');
    const imgPath = `/${(req.params as unknown as string[])[0] || ''}`;
    if (!isValidImgSize(size) || !isValidImgHost(host) || !isValidImgPath(imgPath)) {
      res.status(400).json({ error: 'Invalid image request' });
      return;
    }
    const cached = readCached(size, host, imgPath);
    if (cached) {
      res.setHeader('Content-Type', contentTypeFor(cached.ext, null));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(cached.body);
      return;
    }
    try {
      const up = await fetchUpstream(size, host, imgPath);
      writeCached(size, host, imgPath, up.body);
      res.setHeader('Content-Type', contentTypeFor('', up.contentType));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(up.body);
    } catch {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(FALLBACK_PNG);
    }
  } catch {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Recommend Endpoint
app.post('/api/recommend', rateLimiter, async (req: Request, res: Response) => {
  try {
    const validation = validateRecommendBody(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const sanitizedParams = validation.params;

    // 2. Live discovery: widen the candidate pool via TMDB when configured.
    const tmdbApiKey = process.env.TMDB_API_KEY?.trim();
    let extraCandidates: MovieItem[] = [];
    if (tmdbApiKey) {
      try {
        const found = await discoverCandidates(
          {
            genres: sanitizedParams.genres,
            languages: sanitizedParams.languages,
            maxRuntime: sanitizedParams.maxRuntime,
            highlyRated: Boolean(sanitizedParams.preferences?.highlyRated),
            recent: Boolean(sanitizedParams.preferences?.recent),
            classics: Boolean(sanitizedParams.preferences?.classics),
            family: sanitizedParams.audience === 'Family with kids',
            mature: Boolean(sanitizedParams.preferences?.mature),
            excludeIds: sanitizedParams.excludeIds || [],
          },
          tmdbApiKey
        );
        if (found && found.length > 0) {
          const runtimes = await enrichRuntimes(found, tmdbApiKey);
          for (const m of found) {
            const details = runtimes.get(m.id);
            if (details) {
              if (details.runtime > 0) m.runtime = details.runtime;
              if (details.genres.length > 0) m.genres = details.genres;
            }
          }
          extraCandidates = found;
        }
      } catch {
        extraCandidates = [];
      }
    }

    // 2b. Database candidates join the pool (SQL-filtered by the shared pipeline).
    try {
      const currentYear = new Date().getFullYear();
      const langs = sanitizedParams.languages.includes('Any')
        ? []
        : sanitizedParams.languages.map((l: string) => LANGUAGE_CODES[l]).filter(Boolean);
      const { items: dbItems } = await loadDbCandidates({
        types: sanitizedParams.types ?? ['movie'],
        genres: sanitizedParams.genres.filter((g: string) => g !== 'Surprise me'),
        excludeGenres: [],
        languages: langs,
        runtimeMin: null,
        runtimeMax: runtimeCap(sanitizedParams.maxRuntime),
        yearMin: sanitizedParams.preferences?.recent ? currentYear - 5 : null,
        yearMax: sanitizedParams.preferences?.classics ? 1999 : null,
        ratingFloor: sanitizedParams.preferences?.highlyRated ? 7.0 : null,
        seasonsMax: sanitizedParams.maxRuntime === 'Miniseries (1 season)' ? 1 : null,
        audience: sanitizedParams.audience,
        matureAllowed: sanitizedParams.audience !== 'Family with kids' &&
          Boolean(sanitizedParams.preferences?.mature),
        excludeIds: (sanitizedParams.excludeIds || []).map(Number).filter(Number.isFinite),
        limit: 500,
      });
      extraCandidates.push(...dbItems);
    } catch {
      // loader falls back internally; never break recommend
    }

    // 3. Recommend (filter → rank → diversify) + enrich via OMDb API
    const omdbApiKey = process.env.OMDB_API_KEY?.trim();
    const {
      movies: recommended,
      notices,
      effective,
    } = await getRecommendationsWithOMDb(sanitizedParams, omdbApiKey, extraCandidates);

    // 3b. Final gate: enforce the REQUESTED constraints on enriched values
    const requestedLangCodes: string[] = [];
    if (
      sanitizedParams.languages.length > 0 &&
      !sanitizedParams.languages.includes('Any')
    ) {
      for (const l of sanitizedParams.languages) {
        if (LANGUAGE_CODES[l]) requestedLangCodes.push(LANGUAGE_CODES[l]);
      }
    }
    const gated = enforceHardConstraints(recommended, {
      maxMinutes: runtimeCap(sanitizedParams.maxRuntime),
      maxRuntimeLabel: sanitizedParams.maxRuntime,
      langCodes: requestedLangCodes,
      highlyRated: effective.highlyRated,
      recent: effective.recent,
      classics: effective.classics,
      audience: sanitizedParams.audience,
      matureAllowed:
        sanitizedParams.audience !== 'Family with kids' &&
        Boolean(sanitizedParams.preferences?.mature),
      types: sanitizedParams.types ?? ['movie'],
      seasonsMax: sanitizedParams.maxRuntime === 'Miniseries (1 season)' ? 1 : null,
    });
    let picks = gated.movies;
    const allNotices = [...notices, ...gated.relaxed];

    // 3. Optional server-side AI reasoning (new LLM picker)
    if (AI_ENABLED && process.env.GEMINI_API_KEY && picks.length > 0) {
      picks = await enhanceWithGemini(
        picks,
        sanitizedParams.mood,
        sanitizedParams.audience,
        sanitizedParams.note,
        recommended, // full candidates before gating
        { genres: sanitizedParams.genres, preferences: sanitizedParams.preferences, referenceIds: sanitizedParams.referenceIds },
        [] // saved titles - could be fetched from DB if needed
      );
    }

    // 4. Live "where to watch" availability via Watchmode
    const watchmodeKey = process.env.WATCHMODE_API_KEY?.trim();
    if (watchmodeKey && picks.length > 0) {
      const region = (process.env.WATCHMODE_REGION || 'IN').trim().toUpperCase();
      picks = await attachLiveProviders(picks, watchmodeKey, region);
    }

    // 5. E11: serve all artwork through our /img proxy
    for (const m of picks as { posterUrl: string; providers: { logoUrl: string }[] }[]) {
      const local = toLocalImg(m.posterUrl);
      if (local) m.posterUrl = local;
      for (const p of m.providers || []) {
        const ll = toLocalImg(p.logoUrl);
        if (ll) p.logoUrl = ll;
      }
    }

    // 6. Learning (Step 1): one signed impression per shown pick.
    let impressionTokens: { movieId: number; impressionId: string; token: string }[] = [];
    await initLearning();
    if (learningDb) {
      const mod = await loadLearningModule();
      const anonId = mod.normalizeAnonId((req.body as { anonId?: unknown } | null)?.anonId);
      const contextKey = mod.buildContextKey(sanitizedParams, sanitizedParams.note);
      const ts = Date.now();
      type ImpressionRow = {
        impressionId: string;
        anonId: string;
        ts: number;
        contextKey: string;
        movieId: number;
        slot: number;
        rankPosition: number;
        isExploration: number;
        explorationProb: number;
        scoreBreakdownJson: string;
        variant: string;
      };
      const rows: ImpressionRow[] = picks.map((m: MoviePick, idx: number) => ({
        impressionId: randomUUID(),
        anonId,
        ts,
        contextKey,
        movieId: m.id,
        slot: idx,
        rankPosition: idx + 1,
        isExploration: 0,
        explorationProb: 0,
        scoreBreakdownJson: JSON.stringify({ fitScore: m.fitScore ?? null }),
        variant: 'control',
      }));
      mod.recordImpressions(learningDb, rows);
      impressionTokens = rows.map((r) => ({
        movieId: r.movieId,
        impressionId: r.impressionId,
        token: mod.signImpression(r.impressionId, r.movieId, anonId),
      }));
    }

    res.json({ movies: picks, notices: allNotices, impressionTokens });
  } catch {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Learning events (Step 1): feedback for a shown impression.
app.post('/api/event', rateLimiter, async (req: Request, res: Response) => {
  try {
    await initLearning();
    const mod = await loadLearningModule();
    if (!mod || !learningDb) {
      res.status(503).json({ error: 'Learning is disabled' });
      return;
    }
    if (JSON.stringify(req.body ?? null).length > mod.MAX_EVENT_BODY_BYTES) {
      res.status(413).json({ error: 'Event too large' });
      return;
    }
    const validation = mod.validateEventBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const evt = validation.value;
    const now = Date.now();
    if (mod.burstExceeded(eventBursts, `anon:${evt.anonId}`, mod.EVENT_BURST_PER_ANON, mod.EVENT_BURST_WINDOW_MS, now)) {
      res.status(429).json({ error: 'Too many events. Please try again later.' });
      return;
    }
    const ipHash = mod.hashIp(req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown');
    if (mod.burstExceeded(eventBursts, `ip:${ipHash}`, mod.EVENT_BURST_PER_IPHASH, mod.EVENT_BURST_WINDOW_MS, now)) {
      res.status(429).json({ error: 'Too many events. Please try again later.' });
      return;
    }
    const ver = mod.verifyImpression(evt.token, evt.anonId);
    if (!ver.ok) {
      res.status(401).json({ error: 'Invalid or expired event token' });
      return;
    }
    if (ver.impressionId !== evt.impressionId || ver.movieId !== evt.movieId) {
      res.status(401).json({ error: 'Event does not match its token' });
      return;
    }
    const imp = mod.findImpression(learningDb, ver.impressionId);
    if (!imp || imp.movieId !== evt.movieId || imp.anonId !== evt.anonId) {
      res.status(401).json({ error: 'Unknown impression' });
      return;
    }
    if (mod.anonOverDailyCap(learningDb, evt.anonId, now)) {
      res.status(429).json({ error: 'Daily event cap reached' });
      return;
    }
    const outcome = mod.recordEvent(learningDb, {
      eventId: evt.eventId,
      impressionId: evt.impressionId,
      anonId: evt.anonId,
      action: evt.action,
      movieId: evt.movieId,
      ts: now,
    });
    res.json({ ok: true, duplicate: outcome === 'duplicate' });
  } catch {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// "Reset my taste": delete every stored row tied to this anonymous id.
app.post('/api/taste/reset', rateLimiter, async (req: Request, res: Response) => {
  try {
    await initLearning();
    const mod = learningDb ? await loadLearningModule() : null;
    const anonId = mod ? mod.normalizeAnonId((req.body as { anonId?: unknown } | null)?.anonId) : '';
    const deleted =
      mod && learningDb ? mod.deleteAnonData(learningDb, anonId) : { impressions: 0, events: 0 };
    res.json({ ok: true, deleted });
  } catch {
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Anonymous traffic analytics (see server/analytics.ts).
registerAnalyticsRoutes(app);

// Export for Vercel serverless
export default app;