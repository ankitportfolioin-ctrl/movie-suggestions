import path from 'path';
import { fileURLToPath } from 'url';
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
import {
  LEARNING_ENABLED,
  MAX_EVENT_BODY_BYTES,
  EVENT_BURST_WINDOW_MS,
  EVENT_BURST_PER_ANON,
  EVENT_BURST_PER_IPHASH,
  anonOverDailyCap,
  buildContextKey,
  burstExceeded,
  findImpression,
  hashIp,
  normalizeAnonId,
  openLearningDb,
  recordEvent,
  recordImpressions,
  signImpression,
  validateEventBody,
  verifyImpression,
  type BurstSlot,
} from './server/learning.js';

dotenv.config();

// Learning store (Step 1): signed impressions + feedback events + priors.
// Disabled entirely when LEARNING_ENABLED=false.
const learningDb = LEARNING_ENABLED ? openLearningDb() : null;
// Burst gates for /api/event: per anonId and per hashed IP (raw IPs never stored).
const eventBursts = new Map<string, BurstSlot>();

// Configuration Constants
export const AI_ENABLED = true;
const PORT = parseInt(process.env.PORT || '3000', 10);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security Headers (CSP off in dev so Vite HMR/inline preamble isn't blocked)
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
  // Socket IP only: x-forwarded-for is client-controlled unless
  // Express 'trust proxy' is set for a known proxy, so never use it here.
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  // Occasional sweep so the map stays bounded on long-running servers.
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

// Health Check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

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

// Natural Language Search Endpoint
app.post('/api/search', rateLimiter, async (req: Request, res: Response) => {
  try {
    const { query, excludeIds } = req.body || {};
    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      res.status(400).json({ error: 'Invalid query' });
      return;
    }

    // Parse the natural language query into structured params
    const { parseNote } = await import('./server/noteParser.js');
    const note = parseNote(query);

    // Build recommendation params from parsed note
    const mood = note.moods[0] || 'Relaxed';
    const genres = note.genres.length > 0 ? note.genres : ['Surprise me'];
    const audience = 'Just me';
    const maxRuntime = note.runtimeHint === 'short' ? 'Under 90 min' : 
                       note.runtimeHint === 'long' ? 'Under 2.5 hours' : 'Under 2 hours';
    const languages = note.languageHints.length > 0 ? note.languageHints : ['Any'];
    const preferences = {
      highlyRated: note.wantsHighlyRated || false,
      hiddenGems: false,
      recent: note.eraHint === 'recent',
      classics: note.eraHint === 'classics',
      mature: false,
    };
    const excludeGenres = note.excludeGenres;
    const excludePeople = note.excludedPeople;

    // Use the existing recommendation pipeline with parsed params
    const tmdbApiKey = process.env.TMDB_API_KEY?.trim();
    let extraCandidates: MovieItem[] = [];
    if (tmdbApiKey) {
      try {
        const found = await discoverCandidates(
          {
            genres,
            languages,
            maxRuntime,
            highlyRated: preferences.highlyRated,
            recent: preferences.recent,
            classics: preferences.classics,
            family: audience === 'Family with kids',
            mature: preferences.mature,
            excludeIds: excludeIds || [],
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

    const { FALLBACK_CATALOG } = await import('./server/catalog.js');
    const pool = [...FALLBACK_CATALOG, ...extraCandidates];

    // Apply note-based genre exclusions
    let filtered = pool.filter(m => !excludeGenres.some(g => m.genres.includes(g)));

    // Apply people exclusions (basic - would need OMDb enrichment for full cast)
    // For now, just filter by note

    // Apply hard filters
    const { runtimeCap } = await import('./server/omdb.js');
    const maxMinutes = runtimeCap(maxRuntime);
    filtered = filtered.filter(m => m.runtime <= maxMinutes);

    if (languages.length > 0 && !languages.includes('Any')) {
      const { LANGUAGE_CODES } = await import('./server/omdb.js');
      const langCodes = languages.map(l => LANGUAGE_CODES[l]).filter(Boolean);
      filtered = filtered.filter(m => langCodes.includes(m.language));
    }

    if (preferences.highlyRated) {
      filtered = filtered.filter(m => m.rating >= 7.0);
    }

    const currentYear = new Date().getFullYear();
    if (preferences.recent) {
      filtered = filtered.filter(m => m.year >= currentYear - 5);
    }
    if (preferences.classics) {
      filtered = filtered.filter(m => m.year < 2000);
    }

    // Remove excluded IDs
    const excludeSet = new Set(excludeIds || []);
    filtered = filtered.filter(m => !excludeSet.has(m.id));

    // Simple ranking by genre overlap + rating
    const moodGenresMap = (await import('./server/omdb.js')).MOOD_GENRES;
    const moodGenreList = moodGenresMap[mood] || ['Comedy', 'Adventure'];
    const quizGenres = genres.includes('Surprise me') ? moodGenreList : genres.filter(g => g !== 'Surprise me');

    const scored = filtered.map(movie => {
      let score = movie.rating * 2; // rating base
      const genreOverlap = movie.genres.filter(g => quizGenres.includes(g)).length;
      score += genreOverlap * 3;
      const moodOverlap = movie.genres.filter(g => moodGenreList.includes(g)).length;
      score += moodOverlap * 2;
      return { movie, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3).map((s, idx) => ({
      ...s.movie,
      matchScore: 95 - idx * 2,
      reason: `Matches your ${mood.toLowerCase()} mood with ${s.movie.genres.slice(0,2).join(' & ')}.`,
    }));

    res.json({ 
      movies: top3, 
      parsed: { mood, genres, excludeGenres, runtimeHint: note.runtimeHint, languageHints: note.languageHints, eraHint: note.eraHint },
      notices: excludeGenres.length > 0 ? [`Excluding ${excludeGenres.join(', ')}`] : [],
    });
  } catch (err) {
    console.error('Natural language search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Artwork proxy: GET /img/:size/:host/:path* (E11 — the browser never
// requests image.tmdb.org, m.media-amazon.com or cdn.watchmode.com
// directly). Disk-cached, long Cache-Control.
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
      // Upstream hiccup or stale hash: 200 placeholder, never a
      // console-erroring 5xx. Not cached, so a transient failure
      // retries upstream next time instead of poisoning the cache.
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
    // Absent key or any failure → local catalog only (never an error).
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
    // so no ladder rung, fallback, or live-data overwrite can leak a
    // violator into the response. Only ever removes; removals disclosed.
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

    // 3. Optional server-side AI reasoning
    if (AI_ENABLED && process.env.GEMINI_API_KEY && picks.length > 0) {
      picks = await enhanceWithGemini(
        picks,
        sanitizedParams.mood,
        sanitizedParams.audience,
        sanitizedParams.note
      );
    }

    // 4. Live "where to watch" availability via Watchmode (falls back
    // to catalog providers when the key is missing or a lookup fails).
    const watchmodeKey = process.env.WATCHMODE_API_KEY?.trim();
    if (watchmodeKey && picks.length > 0) {
      const region = (process.env.WATCHMODE_REGION || 'IN').trim().toUpperCase();
      picks = await attachLiveProviders(picks, watchmodeKey, region);
    }

    // 5. E11: serve all artwork through our /img proxy so the browser
    // never requests image.tmdb.org (or any third-party host) directly.
    for (const m of picks as { posterUrl: string; providers: { logoUrl: string }[] }[]) {
      const local = toLocalImg(m.posterUrl);
      if (local) m.posterUrl = local;
      for (const p of m.providers || []) {
        const ll = toLocalImg(p.logoUrl);
        if (ll) p.logoUrl = ll;
      }
    }

    // 6. Learning (Step 1): one signed impression per shown pick.
    // Tokens bind impressionId + movieId + anonId + expiry; events
    // without a valid token are rejected. Filters are untouched.
    let impressionTokens: { movieId: number; impressionId: string; token: string }[] = [];
    if (learningDb) {
      const anonId = normalizeAnonId((req.body as { anonId?: unknown } | null)?.anonId);
      const contextKey = buildContextKey(sanitizedParams, sanitizedParams.note);
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
      recordImpressions(learningDb, rows);
      impressionTokens = rows.map((r) => ({
        movieId: r.movieId,
        impressionId: r.impressionId,
        token: signImpression(r.impressionId, r.movieId, anonId),
      }));
    }

    res.json({ movies: picks, notices: allNotices, impressionTokens });
  } catch {
    // Return generic 500 error, never leak debug or keys
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Learning events (Step 1): feedback for a shown impression.
// Accepts ONLY events carrying a valid HMAC token; idempotent by eventId.
app.post('/api/event', rateLimiter, async (req: Request, res: Response) => {
  try {
    if (!LEARNING_ENABLED || !learningDb) {
      res.status(503).json({ error: 'Learning is disabled' });
      return;
    }
    if (JSON.stringify(req.body ?? null).length > MAX_EVENT_BODY_BYTES) {
      res.status(413).json({ error: 'Event too large' });
      return;
    }
    const validation = validateEventBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const evt = validation.value;
    const now = Date.now();
    if (burstExceeded(eventBursts, `anon:${evt.anonId}`, EVENT_BURST_PER_ANON, EVENT_BURST_WINDOW_MS, now)) {
      res.status(429).json({ error: 'Too many events. Please try again later.' });
      return;
    }
    const ipHash = hashIp(req.socket.remoteAddress || 'unknown');
    if (burstExceeded(eventBursts, `ip:${ipHash}`, EVENT_BURST_PER_IPHASH, EVENT_BURST_WINDOW_MS, now)) {
      res.status(429).json({ error: 'Too many events. Please try again later.' });
      return;
    }
    const ver = verifyImpression(evt.token, evt.anonId);
    if (!ver.ok) {
      res.status(401).json({ error: 'Invalid or expired event token' });
      return;
    }
    if (ver.impressionId !== evt.impressionId || ver.movieId !== evt.movieId) {
      res.status(401).json({ error: 'Event does not match its token' });
      return;
    }
    const imp = findImpression(learningDb, ver.impressionId);
    if (!imp || imp.movieId !== evt.movieId || imp.anonId !== evt.anonId) {
      res.status(401).json({ error: 'Unknown impression' });
      return;
    }
    if (anonOverDailyCap(learningDb, evt.anonId, now)) {
      res.status(429).json({ error: 'Daily event cap reached' });
      return;
    }
    const outcome = recordEvent(learningDb, {
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

// Vite or Static Serving
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    // Unknown API routes: JSON 404 (must come before the SPA fallback).
    app.all('/api/*', (_req: Request, res: Response) => {
      res.status(404).json({ error: 'Not found' });
    });
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    // Dev server started cleanly
  });
}

startServer();
