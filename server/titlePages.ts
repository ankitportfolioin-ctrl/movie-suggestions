/**
 * Deterministic discovery features (no AI / LLM anywhere):
 *  - similarTitles(): "more like this" ranked by shared genres + shared TMDB
 *    keywords + same kind/language, tie-broken by rating and vote volume.
 *  - renderTitlePage(): server-rendered, crawlable HTML for /title/:imdbId with
 *    OpenGraph/Twitter tags and schema.org JSON-LD, so each of the ~20k titles
 *    can be indexed by search engines and shared with a rich preview.
 *  - renderSitemap()/ROBOTS_TXT: let crawlers discover every title page.
 * Pure renderers are unit-tested without a database.
 */
// Loaded lazily so the pure renderers stay importable (and unit-testable) without a DB driver.
const getDbPool = async () => (await import('./dbMovies.js')).getDbPool();

export interface TitleRow {
  imdbId: string;
  title: string;
  year: number | null;
  type: string;
  runtime: number | null;
  genres: string[];
  overview: string;
  rating: number | null;
  votes: number | null;
  posterPath: string | null;
  certificate: string;
  minAge: number | null;
  seasons: number | null;
  language: string;
}

export interface SimilarRow {
  imdbId: string;
  title: string;
  year: number | null;
  type: string;
  rating: number | null;
  posterPath: string | null;
}

const IMDB_ID = /^tt\d{5,10}$/;
export const isImdbId = (s: unknown): s is string => typeof s === 'string' && IMDB_ID.test(s);

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON for a <script type="application/ld+json"> block: "<" can never close it. */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
}

const posterUrl = (p: string | null, base: string, size = 'w342') =>
  p ? `${base}/img/${size}/tmdb${p}` : '';

function rowToTitle(r: Record<string, unknown>): TitleRow {
  return {
    imdbId: r.imdbid as string,
    title: r.title as string,
    year: (r.year as number) ?? null,
    type: (r.type as string) || 'movie',
    runtime: (r.runtime as number) ?? null,
    genres: (r.genres as string[]) || [],
    overview: (r.overview as string) || '',
    rating: (r.rating as number) ?? null,
    votes: (r.votes as number) ?? null,
    posterPath: (r.posterpath as string) ?? null,
    certificate: (r.certificate as string) || '',
    minAge: (r.minage as number) ?? null,
    seasons: (r.seasons as number) ?? null,
    language: (r.originallanguage as string) || 'en',
  };
}

export async function getTitle(imdbId: string): Promise<TitleRow | null> {
  if (!isImdbId(imdbId)) return null;
  const { rows } = await (await getDbPool()).query(
    `SELECT imdbId, title, year, type, runtime, genres, overview, rating, votes, posterPath,
            certificate, minAge, seasons, originalLanguage
       FROM movies WHERE imdbId = $1 AND adult IS NOT TRUE LIMIT 1`,
    [imdbId],
  );
  return rows[0] ? rowToTitle(rows[0]) : null;
}

/**
 * "More like this". Score = 3 x shared genres + 2 x shared keywords
 * + 1 x same original language, then a small quality prior
 * (rating, ln(votes)) so obscure low-vote titles do not win on a keyword tie.
 * Same kind only (a movie page suggests movies, a series page series), and a
 * title that is not for adults never recommends 16+ content.
 */
const SIMILAR_SELECT = `
  WITH src AS (
    SELECT genres g, COALESCE(keywords, '{}') k, type t, originalLanguage l, COALESCE(minAge, 0) a
      FROM movies WHERE imdbId = $1 LIMIT 1)
  SELECT m.imdbId, m.title, m.year, m.type, m.rating, m.posterPath
    FROM movies m, src
   WHERE m.imdbId <> $1 AND m.imdbId LIKE 'tt%'
     AND m.adult IS NOT TRUE AND m.posterPath IS NOT NULL
     AND m.type = src.t AND m.genres && src.g
     AND COALESCE(m.votes, 0) >= 500
     AND (src.a >= 16 OR COALESCE(m.minAge, 0) < 16)
   ORDER BY (
       3 * cardinality(ARRAY(SELECT unnest(m.genres) INTERSECT SELECT unnest(src.g)))
     + __KEYWORD_SCORE__
     + (m.originalLanguage = src.l)::int
     + LEAST(COALESCE(m.rating, 0), 10) * 0.7
     + ln(1 + COALESCE(m.votes, 0)) * 0.35
   ) DESC
   LIMIT $2`;

/** Shared keywords weighted by rarity (TF-IDF idea): "dream world" says far more than "mission". */
const IDF_SCORE = `COALESCE((SELECT sum(ln(20000.0 / d.df)) FROM keyword_df d
     WHERE d.k = ANY(m.keywords) AND d.k = ANY(src.k)), 0)`;
/** Fallback when the keyword_df table has not been built: plain overlap count. */
const PLAIN_SCORE = `2 * cardinality(ARRAY(SELECT unnest(COALESCE(m.keywords, '{}')) INTERSECT SELECT unnest(src.k)))`;

/**
 * "More like this". Score = 3 x shared genres + rarity-weighted shared
 * keywords + same original language + a quality prior (rating, ln(votes)) so
 * obscure titles do not win on a keyword tie. Same kind only (a movie page
 * suggests movies, a series page series), and a title that is not for adults
 * never recommends 16+ content.
 */
export async function similarTitles(imdbId: string, limit = 12): Promise<SimilarRow[]> {
  if (!isImdbId(imdbId)) return [];
  const pool = await getDbPool();
  const params = [imdbId, Math.min(Math.max(limit, 1), 24)];
  let rows: Record<string, any>[];
  try {
    rows = (await pool.query(SIMILAR_SELECT.replace('__KEYWORD_SCORE__', IDF_SCORE), params)).rows;
  } catch {
    rows = (await pool.query(SIMILAR_SELECT.replace('__KEYWORD_SCORE__', PLAIN_SCORE), params)).rows;
  }
  return rows.map((r) => ({
    imdbId: r.imdbid,
    title: r.title,
    year: r.year ?? null,
    type: r.type || 'movie',
    rating: r.rating ?? null,
    posterPath: r.posterpath ?? null,
  }));
}

export function ageLabel(t: Pick<TitleRow, 'minAge'>): string {
  if (typeof t.minAge !== 'number') return 'Rating not confirmed';
  if (t.minAge <= 6) return 'All ages';
  return `${t.minAge}+`;
}

export function renderTitlePage(t: TitleRow, similar: SimilarRow[], base: string): string {
  const url = `${base}/title/${t.imdbId}`;
  const kind = t.type === 'series' ? 'TV series' : t.type === 'short' ? 'short film' : 'movie';
  const heading = `${t.title}${t.year ? ` (${t.year})` : ''}`;
  const desc = (t.overview || `${t.title} is a ${t.genres.join(', ').toLowerCase() || kind}.`)
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  const poster = posterUrl(t.posterPath, base, 'w500');
  const facts = [
    t.type === 'series' ? (t.seasons ? `${t.seasons} season${t.seasons === 1 ? '' : 's'}` : 'TV series') : t.runtime ? `${t.runtime} min` : '',
    t.rating ? `★ ${t.rating.toFixed(1)}${t.votes ? ` (${t.votes.toLocaleString('en-US')} votes)` : ''}` : '',
    ageLabel(t),
    t.genres.join(' · '),
  ].filter(Boolean);

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': t.type === 'series' ? 'TVSeries' : 'Movie',
    name: t.title,
    url,
    description: desc,
    genre: t.genres,
    ...(poster ? { image: poster } : {}),
    ...(t.year ? { datePublished: String(t.year) } : {}),
    ...(t.rating && t.votes
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(t.rating.toFixed(1)), bestRating: 10, ratingCount: t.votes } }
      : {}),
  };

  const sim = similar
    .map(
      (s) => `<li><a href="/title/${s.imdbId}">${
        s.posterPath ? `<img src="${escapeHtml(posterUrl(s.posterPath, ''))}" alt="" loading="lazy" width="120" height="180">` : ''
      }<span>${escapeHtml(s.title)}${s.year ? ` (${s.year})` : ''}</span></a></li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)} - ${kind} details & similar picks | CineMatch</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="${t.type === 'series' ? 'video.tv_show' : 'video.movie'}">
<meta property="og:title" content="${escapeHtml(heading)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${escapeHtml(url)}">
${poster ? `<meta property="og:image" content="${escapeHtml(poster)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${safeJsonLd(ld)}</script>
<style>
body{margin:0;background:#0a0a0a;color:#f5f5f5;font:16px/1.6 Inter,system-ui,sans-serif}
main{max-width:880px;margin:0 auto;padding:24px 16px 64px}
a{color:#ff6b78}.top{display:flex;gap:24px;flex-wrap:wrap}.top img{width:220px;height:auto;border-radius:12px}
h1{margin:.2em 0}.facts{color:#a8a8a8}ul.sim{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:16px}
ul.sim a{text-decoration:none;color:inherit;font-size:14px;display:block}ul.sim img{display:block;border-radius:8px;margin-bottom:4px;width:100%;height:auto}
.cta{display:inline-block;margin:16px 0;padding:10px 18px;background:#e63946;color:#fff;border-radius:999px;text-decoration:none;font-weight:600}
</style></head><body><main>
<nav><a href="/">← CineMatch</a></nav>
<div class="top">${poster ? `<img src="${escapeHtml(posterUrl(t.posterPath, '', 'w500'))}" alt="Poster of ${escapeHtml(t.title)}" width="220" height="330">` : ''}
<div style="flex:1;min-width:260px"><h1>${escapeHtml(heading)}</h1>
<p class="facts">${facts.map(escapeHtml).join(' · ')}</p>
<p>${escapeHtml(t.overview || 'No synopsis available yet.')}</p>
<a class="cta" href="/">Get picks for your mood</a></div></div>
${sim ? `<h2>More like ${escapeHtml(t.title)}</h2><ul class="sim">${sim}</ul>` : ''}
</main></body></html>`;
}

export function renderNotFoundPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Title not found | CineMatch</title></head><body style="background:#0a0a0a;color:#f5f5f5;font-family:system-ui;padding:32px"><h1>We couldn't find that title</h1><p><a style="color:#ff6b78" href="/">Back to CineMatch</a></p></body></html>`;
}

export function renderSitemap(ids: string[], base: string): string {
  const urls = [`<url><loc>${escapeHtml(base)}/</loc></url>`]
    .concat(ids.filter(isImdbId).map((id) => `<url><loc>${escapeHtml(base)}/title/${id}</loc></url>`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function robotsTxt(base: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`;
}

export async function sitemapIds(limit = 20000): Promise<string[]> {
  const { rows } = await (await getDbPool()).query(
    `SELECT imdbId FROM movies
      WHERE imdbId LIKE 'tt%' AND adult IS NOT TRUE AND posterPath IS NOT NULL
      ORDER BY popularity DESC NULLS LAST LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.imdbid as string);
}
