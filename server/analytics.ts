/**
 * Anonymous traffic analytics: pageviews, sessions, geo (Vercel headers),
 * and dashboard/realtime queries. Public data only — IPs are hashed.
 */
import type { Request, Response, NextFunction, Express } from 'express';
import { createHash } from 'node:crypto';
import { getPool } from './db.js';

function hashIp(ip: string): string {
  return createHash('sha256').update(ip + (process.env.IP_HASH_SALT || 'cinematch-salt')).digest('hex');
}

const REGION_NAMES: Record<string, Record<string, string>> = {
  US: { CA: 'California', NY: 'New York', TX: 'Texas', FL: 'Florida', WA: 'Washington' },
  IN: { MH: 'Maharashtra', KA: 'Karnataka', DL: 'Delhi', TN: 'Tamil Nadu', TG: 'Telangana' },
  GB: { ENG: 'England', SCT: 'Scotland', WLS: 'Wales', NIR: 'Northern Ireland' },
  CA: { ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia', AB: 'Alberta' },
  AU: { NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', WA: 'Western Australia' },
};

function parseGeoData(req: Request) {
  const h = req.headers;
  const countryCode = (h['x-vercel-ip-country'] as string)?.toUpperCase() || null;
  const regionCode = (h['x-vercel-ip-country-region'] as string) || null;
  return {
    countryCode,
    countryName: (h['x-vercel-ip-country-name'] as string) || null,
    regionCode,
    regionName: countryCode && regionCode ? REGION_NAMES[countryCode]?.[regionCode] || regionCode : null,
    city: (h['x-vercel-ip-city'] as string) || null,
    latitude: parseFloat(h['x-vercel-ip-latitude'] as string) || null,
    longitude: parseFloat(h['x-vercel-ip-longitude'] as string) || null,
  };
}

// 120 req/min per IP — beacons fire once per page view, this is generous.
const rateLimits = new Map<string, { count: number; resetTime: number }>();
function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  if (rateLimits.size > 5000) {
    for (const [k, v] of rateLimits) if (v.resetTime <= now) rateLimits.delete(k);
  }
  const entry = rateLimits.get(ip);
  if (!entry || entry.resetTime <= now) {
    rateLimits.set(ip, { count: 1, resetTime: now + 60_000 });
    return next();
  }
  if (entry.count >= 120) {
    res.status(429).json({ error: 'Analytics rate limit exceeded' });
    return;
  }
  entry.count += 1;
  next();
}

function intervalFor(range: string | undefined): string {
  switch (range) {
    case '1h': return '1 hour';
    case '24h': return '24 hours';
    case '30d': return '30 days';
    default: return '7 days';
  }
}

export function registerAnalyticsRoutes(app: Express): void {
  app.post('/api/analytics/pageview', rateLimiter, async (req: Request, res: Response) => {
    try {
      const { sessionId, anonId, path, referrer, viewportWidth, viewportHeight, screenWidth, screenHeight, language, timezone } = req.body || {};
      if (!sessionId || !anonId || !path) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }
      const ipHash = hashIp(req.socket.remoteAddress || 'unknown');
      const geo = parseGeoData(req);
      const userAgent = req.headers['user-agent'] || '';
      const pool = getPool();
      await pool.query(
        `INSERT INTO analytics_page_views (
          session_id, anon_id, path, referrer, user_agent,
          viewport_width, viewport_height, screen_width, screen_height,
          language, timezone, ip_hash,
          country_code, country_name, region_code, region_name, city, latitude, longitude
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [sessionId, anonId, path, referrer || null, userAgent,
          viewportWidth || null, viewportHeight || null, screenWidth || null, screenHeight || null,
          language || null, timezone || null, ipHash,
          geo.countryCode, geo.countryName, geo.regionCode, geo.regionName, geo.city, geo.latitude, geo.longitude],
      );
      await pool.query(
        `INSERT INTO analytics_sessions (
          id, anon_id, first_seen, last_seen, total_page_views,
          country_code, country_name, region_code, region_name, city, latitude, longitude, ip_hash, user_agent, is_returning
        ) VALUES ($1,$2,NOW(),NOW(),1,$3,$4,$5,$6,$7,$8,$9,$10,$11, FALSE)
        ON CONFLICT (anon_id) DO UPDATE SET
          last_seen = NOW(),
          total_page_views = analytics_sessions.total_page_views + 1,
          country_code = COALESCE($3, analytics_sessions.country_code),
          country_name = COALESCE($4, analytics_sessions.country_name),
          region_code = COALESCE($5, analytics_sessions.region_code),
          region_name = COALESCE($6, analytics_sessions.region_name),
          city = COALESCE($7, analytics_sessions.city),
          latitude = COALESCE($8, analytics_sessions.latitude),
          longitude = COALESCE($9, analytics_sessions.longitude),
          ip_hash = $10,
          user_agent = $11,
          is_returning = TRUE`,
        [sessionId, anonId, geo.countryCode, geo.countryName, geo.regionCode, geo.regionName, geo.city, geo.latitude, geo.longitude, ipHash, userAgent],
      );
      res.json({ ok: true });
    } catch (error) {
      console.error('Analytics pageview error:', error);
      res.status(500).json({ error: 'Failed to track pageview' });
    }
  });

  app.post('/api/analytics/event', rateLimiter, async (req: Request, res: Response) => {
    try {
      const { sessionId, anonId, eventType, eventData, pagePath } = req.body || {};
      if (!sessionId || !anonId || !eventType) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }
      const pool = getPool();
      // Guard: an event beacon may arrive with a session id the DB has never
      // seen (lost pageview). Seed the session row so the FK always passes.
      await pool.query(
        `INSERT INTO analytics_sessions (id, anon_id, ip_hash, is_returning) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
        [sessionId, anonId, hashIp(req.socket.remoteAddress || 'unknown')],
      );
      await pool.query(
        'INSERT INTO analytics_events (session_id, anon_id, event_type, event_data, page_path) VALUES ($1,$2,$3,$4,$5)',
        [sessionId, anonId, eventType, JSON.stringify(eventData || {}), pagePath || null],
      );
      const counters: Record<string, string> = {
        quiz_start: 'total_quiz_starts',
        recommendation_served: 'total_recommendations',
        movie_save: 'total_saves',
      };
      const col = counters[eventType];
      if (col) {
        await pool.query(`UPDATE analytics_sessions SET ${col} = ${col} + 1 WHERE id = $1`, [sessionId]);
      }
      res.json({ ok: true });
    } catch (error) {
      console.error('Analytics event error:', error);
      res.status(500).json({ error: 'Failed to track event' });
    }
  });

  app.get('/api/analytics/dashboard', async (req: Request, res: Response) => {
    try {
      const interval = intervalFor(req.query.range as string);
      const since = `NOW() - INTERVAL '${interval}'`;
      const pool = getPool();
      const [overview, topCountries, topCities, topRegions, topPages, topReferrers, hourly, daily, events, trend] = await Promise.all([
        pool.query(`
          SELECT COUNT(DISTINCT anon_id) AS unique_visitors, COUNT(*) AS total_page_views,
                 COUNT(DISTINCT id) AS total_sessions,
                 COUNT(*) FILTER (WHERE is_returning) AS returning_visitors,
                 COUNT(*) FILTER (WHERE NOT is_returning) AS new_visitors,
                 COALESCE(SUM(total_quiz_starts), 0) AS quiz_starts,
                 COALESCE(SUM(total_recommendations), 0) AS recommendations_served,
                 COALESCE(SUM(total_saves), 0) AS saves
          FROM analytics_sessions WHERE last_seen >= ${since}`),
        pool.query(`
          SELECT country_code, country_name, COUNT(DISTINCT anon_id) AS visitors, COUNT(*) AS page_views
          FROM analytics_page_views
          WHERE created_at >= ${since} AND country_code IS NOT NULL
          GROUP BY country_code, country_name ORDER BY visitors DESC LIMIT 10`),
        pool.query(`
          SELECT city, country_code, country_name, COUNT(DISTINCT anon_id) AS visitors, COUNT(*) AS page_views
          FROM analytics_page_views
          WHERE created_at >= ${since} AND city IS NOT NULL
          GROUP BY city, country_code, country_name ORDER BY visitors DESC LIMIT 10`),
        pool.query(`
          SELECT region_name, country_name, COUNT(DISTINCT anon_id) AS visitors
          FROM analytics_page_views
          WHERE created_at >= ${since} AND region_name IS NOT NULL
          GROUP BY region_name, country_name ORDER BY visitors DESC LIMIT 10`),
        pool.query(`
          SELECT path, COUNT(*) AS page_views, COUNT(DISTINCT anon_id) AS unique_visitors
          FROM analytics_page_views WHERE created_at >= ${since}
          GROUP BY path ORDER BY page_views DESC LIMIT 10`),
        pool.query(`
          SELECT COALESCE(NULLIF(referrer, ''), 'direct') AS referrer, COUNT(*) AS count
          FROM analytics_page_views WHERE created_at >= ${since}
          GROUP BY COALESCE(NULLIF(referrer, ''), 'direct') ORDER BY count DESC LIMIT 10`),
        pool.query(`
          SELECT DATE_TRUNC('hour', created_at) AS hour, COUNT(*) AS page_views, COUNT(DISTINCT anon_id) AS unique_visitors
          FROM analytics_page_views WHERE created_at >= NOW() - INTERVAL '24 hours'
          GROUP BY 1 ORDER BY hour ASC`),
        pool.query(`
          SELECT DATE(created_at) AS day, COUNT(*) AS page_views, COUNT(DISTINCT anon_id) AS unique_visitors
          FROM analytics_page_views WHERE created_at >= ${since}
          GROUP BY 1 ORDER BY day ASC`),
        pool.query(`
          SELECT event_type, COUNT(*) AS count FROM analytics_events
          WHERE created_at >= ${since} GROUP BY 1 ORDER BY count DESC`),
        pool.query(`
          SELECT DATE(pv.created_at) AS day,
                 COUNT(DISTINCT s.anon_id) FILTER (WHERE s.is_returning) AS returning,
                 COUNT(DISTINCT s.anon_id) FILTER (WHERE NOT s.is_returning) AS new_visitors
          FROM analytics_page_views pv JOIN analytics_sessions s ON pv.session_id = s.id
          WHERE pv.created_at >= ${since} GROUP BY 1 ORDER BY day ASC`),
      ]);
      res.json({
        overview: overview.rows[0],
        topCountries: topCountries.rows,
        topCities: topCities.rows,
        topRegions: topRegions.rows,
        topPages: topPages.rows,
        topReferrers: topReferrers.rows,
        hourlyTraffic: hourly.rows,
        dailyTraffic: daily.rows,
        events: events.rows,
        visitorTrend: trend.rows,
        range: req.query.range || '7d',
      });
    } catch (error) {
      console.error('Analytics dashboard error:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
  });

  app.get('/api/analytics/realtime', async (_req: Request, res: Response) => {
    try {
      const pool = getPool();
      const [activeUsers, activePages, activeCountries] = await Promise.all([
        pool.query(`
          SELECT COUNT(DISTINCT anon_id) AS active_visitors, COUNT(*) AS active_page_views, MAX(created_at) AS last_activity
          FROM analytics_page_views WHERE created_at >= NOW() - INTERVAL '5 minutes'`),
        pool.query(`
          SELECT path, COUNT(*) AS views, COUNT(DISTINCT anon_id) AS visitors
          FROM analytics_page_views WHERE created_at >= NOW() - INTERVAL '5 minutes'
          GROUP BY path ORDER BY views DESC LIMIT 10`),
        pool.query(`
          SELECT country_code, country_name, COUNT(DISTINCT anon_id) AS visitors
          FROM analytics_page_views WHERE created_at >= NOW() - INTERVAL '5 minutes' AND country_code IS NOT NULL
          GROUP BY 1,2 ORDER BY visitors DESC LIMIT 10`),
      ]);
      res.json({
        activeVisitors: Number(activeUsers.rows[0]?.active_visitors || 0),
        activePageViews: Number(activeUsers.rows[0]?.active_page_views || 0),
        lastActivity: activeUsers.rows[0]?.last_activity,
        activePages: activePages.rows,
        activeCountries: activeCountries.rows,
      });
    } catch (error) {
      console.error('Analytics realtime error:', error);
      res.status(500).json({ error: 'Failed to fetch realtime data' });
    }
  });
}
