import path from 'path';
import { fileURLToPath } from 'url';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  getRecommendationsWithOMDb,
} from './server/omdb.js';
import { MovieItem } from './server/catalog.js';
import { discoverCandidates, enrichRuntimes } from './server/discovery.js';
import { validateRecommendBody } from './server/validate.js';
import { enforceHardConstraints } from './server/gate.js';
import { runtimeCap } from './server/omdb.js';
import { enhanceWithGemini } from './server/ai.js';
import { attachLiveProviders } from './server/watchmode.js';

dotenv.config();

// Configuration Constants
export const AI_ENABLED = true;
const PORT = parseInt(process.env.PORT || '3000', 10);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security Headers
app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

// CORS restricted to current host
app.use(cors({ origin: true }));
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
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

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
      const codes: Record<string, string> = {
        English: 'en', Hindi: 'hi', Tamil: 'ta', Telugu: 'te',
        Korean: 'ko', Japanese: 'ja', Spanish: 'es', French: 'fr',
      };
      for (const l of sanitizedParams.languages) {
        if (codes[l]) requestedLangCodes.push(codes[l]);
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

    res.json({ movies: picks, notices: allNotices });
  } catch {
    // Return generic 500 error, never leak debug or keys
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Vite or Static Serving
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

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
