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
} from './server/omdb.js';
import { MovieItem } from './server/catalog.js';
import { discoverCandidates, enrichRuntimes } from './server/discovery.js';
import { validateRecommendBody } from './server/validate.js';
import { enforceHardConstraints } from './server/gate.js';
import { runtimeCap } from './server/omdb.js';
import { enhanceWithGemini } from './server/ai.js';
import { attachLiveProviders } from './server/watchmode.js';
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
} from './server/img.js';

// Learning module loaded dynamically to avoid better-sqlite3 on Vercel
let learningModule: any = null;
const LEARNING_ENABLED = process.env.LEARNING_ENABLED === 'true';

async function loadLearningModule() {
  if (!LEARNING_ENABLED) return null;
  if (!learningModule) {
    try {
      learningModule = await import('./server/learning.js');
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
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 30;

function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
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
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
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

// Exact Title Search Endpoint
app.get('/api/search-title', rateLimiter, async (req: Request, res: Response) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query || query.length > 120) {
      res.status(400).json({ error: 'Invalid query' });
      return;
    }

    const tmdbApiKey = process.env.TMDB_API_KEY?.trim();
    if (!tmdbApiKey) {
      // Fallback to local catalog
      const { FALLBACK_CATALOG } = await import('./server/catalog.js');
      const { normalizeTitle } = await import('./server/omdb.js');
      const normQuery = normalizeTitle(query);
      const results = FALLBACK_CATALOG
        .filter(m => normalizeTitle(m.title).includes(normQuery) || normQuery.includes(normalizeTitle(m.title)))
        .slice(0, 10)
        .map(m => ({
          id: m.id,
          title: m.title,
          year: m.year,
          genres: m.genres,
          runtime: m.runtime,
          rating: m.rating,
          overview: m.overview,
          posterUrl: m.posterUrl,
          language: m.language,
        }));
      res.json({ results, source: 'local' });
      return;
    }

    // Search TMDB
    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(query)}&include_adult=false`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'MovieNightPicker/1.0' },
      signal: AbortSignal.timeout(3000),
    });

    if (!searchRes.ok) {
      res.json({ results: [], source: 'tmdb', error: 'Search failed' });
      return;
    }

    const data = await searchRes.json();
    const results = (data.results || [])
      .filter((m: any) => m.poster_path && m.release_date)
      .slice(0, 10)
      .map((m: any) => ({
        id: m.id,
        title: m.title,
        year: parseInt(m.release_date.slice(0, 4), 10),
        genres: [],
        runtime: 0,
        rating: typeof m.vote_average === 'number' ? Math.round(m.vote_average * 10) / 10 : 0,
        overview: m.overview || '',
        posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
        language: m.original_language || 'en',
      }));

    res.json({ results, source: 'tmdb' });
  } catch (err) {
    console.error('Title search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Title Search Endpoint (for reference movie chips)
app.get('/api/title-search', rateLimiter, async (req: Request, res: Response) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query || query.length > 80) {
      res.status(400).json({ error: 'Invalid query' });
      return;
    }

    // Sanitize query - strip HTML/script tags
    const safeQuery = query.replace(/<[^>]*>/g, '');

    const tmdbApiKey = process.env.TMDB_API_KEY?.trim();
    if (!tmdbApiKey) {
      res.json({ results: [] });
      return;
    }

    const cacheKey = safeQuery.toLowerCase();
    const now = Date.now();
    const cached = titleSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      res.json({ results: cached.data });
      return;
    }

    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(safeQuery)}&include_adult=false`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'MovieNightPicker/1.0' },
      signal: AbortSignal.timeout(3000),
    });

    if (!searchRes.ok) {
      res.json({ results: [] });
      return;
    }

    const data = await searchRes.json();
    const results = (data.results || [])
      .filter((m: any) => m.poster_path && m.release_date)
      .slice(0, 5)
      .map((m: any) => ({
        imdbId: m.id.toString(), // TMDB ID used as reference; OMDb lookup will happen later
        title: m.title,
        year: parseInt(m.release_date.slice(0, 4), 10),
        posterUrl: `https://image.tmdb.org/t/p/w500${m.poster_path}`,
      }));

    titleSearchCache.set(cacheKey, { data: results, expiresAt: now + TITLE_SEARCH_TTL });
    res.json({ results });
  } catch {
    res.json({ results: [] });
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
      const rows = picks.map((m, idx) => ({
        impressionId: randomUUID(),
        anonId,
        ts,
        contextKey,
        movieId: m.id,
        slot: idx,
        rankPosition: idx + 1,
        isExploration: 0,
        explorationProb: 0,
        scoreBreakdownJson: JSON.stringify({ matchScore: m.matchScore ?? null }),
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

// Export for Vercel serverless
export default app;