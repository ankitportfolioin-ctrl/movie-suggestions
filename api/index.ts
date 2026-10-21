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
import { loadDbCandidates, loadReferenceAnchors, loadAnchorsByImdb, suggestTitles, rankGateMovies, ensureMinAge, diagnoseEmptyPool } from '../server/dbMovies.js';
import type { DbFilters, DbItem } from '../server/dbMovies.js';
import { validateRecommendBody } from '../server/validate.js';
import { registerAnalyticsRoutes } from '../server/analytics.js';
import { enforceHardConstraints } from '../server/gate.js';
import { runtimeCap } from '../server/omdb.js';
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
  // Fully disabled on Vercel: better-sqlite3 is a native module the
  // serverless bundle can't ship reliably, and the serverless filesystem
  // is read-only outside /tmp — never attempt to load or write there.
  if (!LEARNING_ENABLED || process.env.VERCEL) return null;
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

// JSON parse / body-size errors must be JSON responses, never the HTML
// <pre>Bad Request</pre> page Express's default handler emits (that HTML is
// what clients saw when a request carried malformed JSON).
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }
  next(err);
});

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
// Local-first: the 20k-title database answers autocomplete; the legacy
// provider path only runs when the DB is unreachable.
app.get('/api/search-title', rateLimiter, async (req: Request, res: Response) => {
  try {
    try {
      const items = await suggestTitles(String(req.query.q || ''), 10);
      res.status(200).json({
        results: items.map((m) => ({
          id: m.id,
          title: m.title,
          year: m.year,
          mediaType: m.type === 'series' ? 'tv' : 'movie',
          genres: m.genres,
          runtime: m.runtime,
          rating: m.rating,
          overview: m.overview,
          posterUrl: toLocalImg(m.posterUrl) || m.posterUrl,
          language: m.language,
        })),
        source: 'db',
      });
      return;
    } catch {
      // DB unreachable — fall through to the legacy provider path
    }
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
// Local-first: chips come from the database (real imdbIds + posters), with
// the legacy OMDb path only when the DB is unreachable.
app.get('/api/title-search', rateLimiter, async (req: Request, res: Response) => {
  try {
    const safeQuery = String(req.query.q || '').replace(/<[^>]*>/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

    const now = Date.now();
    const cached = titleSearchCache.get(safeQuery);
    if (cached && cached.expiresAt > now) {
      res.json({ results: cached.data });
      return;
    }

    try {
      const items = await suggestTitles(safeQuery, 5);
      const results = items.map((m) => ({
        imdbId: m.imdbId,
        title: m.title,
        year: m.year,
        posterUrl: toLocalImg(m.posterUrl) || m.posterUrl,
      }));
      titleSearchCache.set(safeQuery, { data: results, expiresAt: now + TITLE_SEARCH_TTL });
      res.json({ results });
      return;
    } catch {
      // DB unreachable — fall through to the legacy OMDb path
    }

    const { searchSuggestions } = await import('../server/titleSearch.js');
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
    const { runNaturalSearch } = await import('../server/searchEngine.js');
    const result = await runNaturalSearch(
      query, (excludeIds || []).map(Number).filter(Number.isFinite),
    );
    res.json(result);
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
// Overall deadline: respond with the best partial results at 22s because
// Vercel hard-kills the function at 30s a" hanging stage otherwise becomes
// a client-side timeout with nothing to show. (No TMDB/OMDb/Watchmode/
// Gemini stages remain in this pipeline; stages are DB + anchors + ranking.)
const RECOMMEND_DEADLINE_MS = 22000;
const STAGE_WARN_MS = 5000;

app.post('/api/recommend', rateLimiter, async (req: Request, res: Response) => {
  try {
    const validation = validateRecommendBody(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const sanitizedParams = validation.params;
    const t0 = Date.now();
    // Stage timing: every allocator records its duration to the log (warn
    // past STAGE_WARN_MS) so slow stages are visible from serverless logs.
    let stageStart = Date.now();
    const logStage = (name: string) => {
      const ms = Date.now() - stageStart;
      const line = `[recommend] stage ${name}: ${ms}ms`;
      if (ms > STAGE_WARN_MS) console.warn(line); else console.log(line);
      stageStart = Date.now();
    };

    const currentYear = new Date().getFullYear();
    const langs = sanitizedParams.languages.includes('Any')
      ? []
      : sanitizedParams.languages.map((l: string) => LANGUAGE_CODES[l]).filter(Boolean);
    // DB filters shared by the main flow and the deadline fallback, built once.
    const dbFilters = {
      types: sanitizedParams.types ?? ['movie'],
      genres: sanitizedParams.genres.filter((g: string) => g !== 'Surprise me'),
      excludeGenres: [] as string[],
      languages: langs,
      runtimeMin: null as number | null,
      runtimeMax: runtimeCap(sanitizedParams.maxRuntime),
      yearMin: sanitizedParams.preferences?.recent ? currentYear - 5 : null,
      yearMax: sanitizedParams.preferences?.classics ? 1999 : null,
      ratingFloor: sanitizedParams.preferences?.highlyRated ? 7.0 : null,
      seasonsMax: sanitizedParams.maxRuntime === 'Miniseries (1 season)' ? 1 : null,
      audience: sanitizedParams.audience,
      matureAllowed: sanitizedParams.audience !== 'Family with kids' &&
        Boolean(sanitizedParams.preferences?.mature),
      excludeIds: (sanitizedParams.excludeIds || []).map(Number).filter(Number.isFinite),
      limit: 2000,
    };

    // All DB candidates gathered so far - the fallback pool if the deadline
    // hits. The SQL already enforced every requested constraint on them.
    let dbPool: DbItem[] = [];

    const flow = async (): Promise<{ picks: MoviePick[]; notices: string[]; impressionTokens: { movieId: number; impressionId: string; token: string }[] }> => {
      // 2. Candidate pool: the local database is the sole source. The 20k
      // title DB is queried with the shared SQL pipeline (genre/runtime/
      // language filters); results are always ours.
      try {
        const { items } = await loadDbCandidates(dbFilters);
        dbPool = items;
      } catch {
        // loader falls back internally; never break recommend
      }
      logStage('db-candidates');

      // 2b. Reference anchors ("movies like X") resolve locally from the DB -
      // their overviews anchor theme similarity without any external API.
      let referenceOverviews: string[] = [];
      if ((sanitizedParams.referenceIds?.length ?? 0) > 0) {
        try {
          const anchors = await loadAnchorsByImdb(sanitizedParams.referenceIds ?? []);
          referenceOverviews = anchors.map((a) => a.overview).filter((o) => o.length > 0);
        } catch {
          referenceOverviews = [];
        }
        logStage('reference-anchors');
      }

      // 3. Recommend (filter -> rank -> diversify) over the DB pool; no OMDb.
      const {
        movies: recommended,
        notices,
        effective,
      } = await getRecommendationsWithOMDb(sanitizedParams, undefined, dbPool as MovieItem[], referenceOverviews);

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
      logStage('rank-gate');

      let picks = gated.movies as MoviePick[];
      const allNotices = [...notices, ...gated.relaxed];

      // 4. E11: serve all artwork through our /img proxy
      for (const m of picks as { posterUrl: string; providers: { logoUrl: string }[] }[]) {
        const local = toLocalImg(m.posterUrl);
        if (local) m.posterUrl = local;
        for (const p of m.providers || []) {
          const ll = toLocalImg(p.logoUrl);
          if (ll) p.logoUrl = ll;
        }
      }

      // 5. Learning (Step 1): one signed impression per shown pick.
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
      logStage('learning');
      return { picks, notices: allNotices, impressionTokens };
    };

    // Deadline race: `expired` resolves null at the deadline; if the flow
    // loses, answer with honest partial picks from the constrained pool.
    const expired = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), RECOMMEND_DEADLINE_MS),
    );
    let outcome = await Promise.race([flow(), expired]);
    if (outcome === null) {
      console.warn(`[recommend] deadline ${RECOMMEND_DEADLINE_MS}ms hit; returning partial results`);
      const requestedLangCodes: string[] = [];
      for (const l of sanitizedParams.languages) {
        if (l !== 'Any' && LANGUAGE_CODES[l]) requestedLangCodes.push(LANGUAGE_CODES[l]);
      }
      const graded = enforceHardConstraints(dbPool as unknown as (DbItem & { minAge?: number | null })[], {
        maxMinutes: runtimeCap(sanitizedParams.maxRuntime),
        maxRuntimeLabel: sanitizedParams.maxRuntime,
        langCodes: requestedLangCodes,
        highlyRated: Boolean(sanitizedParams.preferences?.highlyRated),
        recent: Boolean(sanitizedParams.preferences?.recent),
        classics: Boolean(sanitizedParams.preferences?.classics),
        audience: sanitizedParams.audience,
        matureAllowed:
          sanitizedParams.audience !== 'Family with kids' &&
          Boolean(sanitizedParams.preferences?.mature),
        types: sanitizedParams.types ?? ['movie'],
        seasonsMax: sanitizedParams.maxRuntime === 'Miniseries (1 season)' ? 1 : null,
      });
      const partialPicks = (graded.movies as unknown as MoviePick[]).slice(0, 10);
      for (const m of partialPicks as { posterUrl: string; providers: { logoUrl: string }[] }[]) {
        const local = toLocalImg(m.posterUrl);
        if (local) m.posterUrl = local;
      }
      outcome = {
        picks: partialPicks,
        notices: ['This search needed longer than expected - here are the closest finds we had ready.'],
        impressionTokens: [],
      };
    }

    res.json({ movies: outcome.picks, notices: outcome.notices, impressionTokens: outcome.impressionTokens });
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