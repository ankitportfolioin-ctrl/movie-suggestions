/**
 * Deterministic discovery features (no AI / LLM anywhere):
 *  - similarTitles(): "more like this" ranked by shared genres + rarity-weighted
 *    shared TMDB keywords + same kind/language, tie-broken by rating and votes.
 *  - renderTitlePage(): server-rendered, crawlable HTML for /title/:id with
 *    OpenGraph/Twitter tags and schema.org JSON-LD, so each title can be indexed
 *    by search engines and shared with a rich preview.
 *  - renderSitemap()/robotsTxt(): let crawlers discover every title page.
 *
 * Title ids in URLs: movies/shorts use the IMDb id ("tt1375666"); series have no
 * IMDb id in the catalog so they use "s" + TMDB id ("s1396").
 * Pure renderers are unit-tested without a database.
 */
import type { TitleExtras } from './tmdbDetails.js';

// Loaded lazily so the pure renderers stay importable (and unit-testable) without a DB driver.
const getDbPool = async () => (await import('./dbMovies.js')).getDbPool();

export interface TitleRow {
  tmdbId: number;
  imdbId: string | null;
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
  tmdbId: number;
  imdbId: string | null;
  title: string;
  year: number | null;
  type: string;
  rating: number | null;
  posterPath: string | null;
}

const IMDB_ID = /^tt\d{5,10}$/;
const SERIES_ID = /^s\d{1,9}$/;
export const isImdbId = (s: unknown): s is string => typeof s === 'string' && IMDB_ID.test(s);
export const isTitleId = (s: unknown): s is string =>
  typeof s === 'string' && (IMDB_ID.test(s) || SERIES_ID.test(s));

/** Public URL id for a catalog row (IMDb id when it has one, else "s"+tmdbId for series). */
export function titleIdFor(r: { imdbId: string | null; tmdbId: number; type: string }): string | null {
  if (r.imdbId && IMDB_ID.test(r.imdbId)) return r.imdbId;
  if (r.type === 'series') return `s${r.tmdbId}`;
  return null;
}

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

/** Cut at a word boundary (search snippets read badly when they stop mid-word). */
export function truncateAtWord(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-"']+$/, '')}…`;
}

const posterUrl = (p: string | null, base: string, size = 'w342') =>
  p ? `${base}/img/${size}/tmdb${p}` : '';

/** TMDB provider logos go through our /img proxy (the CSP only allows same-origin images). */
export function localLogo(url: string): string {
  const m = /^https:\/\/image\.tmdb\.org\/t\/p\/(w92|w185)(\/[^?\s]*)$/.exec(url);
  return m ? `/img/${m[1]}/tmdb${m[2]}` : '';
}

const COLS = `tmdbId, imdbId, title, year, type, runtime, genres, overview, rating, votes, posterPath,
            certificate, minAge, seasons, originalLanguage`;

function rowToTitle(r: Record<string, unknown>): TitleRow {
  return {
    tmdbId: r.tmdbid as number,
    imdbId: (r.imdbid as string) || null,
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

export async function getTitle(id: string): Promise<TitleRow | null> {
  if (!isTitleId(id)) return null;
  const bySeries = SERIES_ID.test(id);
  const { rows } = await (await getDbPool()).query(
    `SELECT ${COLS} FROM movies
      WHERE ${bySeries ? `tmdbId = $1 AND type = 'series'` : 'imdbId = $1'} AND adult IS NOT TRUE LIMIT 1`,
    [bySeries ? Number(id.slice(1)) : id],
  );
  return rows[0] ? rowToTitle(rows[0]) : null;
}

const SIMILAR_SELECT = `
  WITH src AS (
    SELECT tmdbId id, genres g, COALESCE(keywords, '{}') k, type t, originalLanguage l, COALESCE(minAge, 0) a
      FROM movies WHERE __SRC__ LIMIT 1)
  SELECT m.tmdbId, m.imdbId, m.title, m.year, m.type, m.rating, m.posterPath
    FROM movies m, src
   WHERE NOT (m.tmdbId = src.id AND m.type = src.t)
     AND (m.imdbId LIKE 'tt%' OR m.type = 'series')
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
export async function similarTitles(id: string, limit = 12): Promise<SimilarRow[]> {
  if (!isTitleId(id)) return [];
  const bySeries = SERIES_ID.test(id);
  const src = bySeries ? `tmdbId = $1 AND type = 'series'` : 'imdbId = $1';
  const params = [bySeries ? Number(id.slice(1)) : id, Math.min(Math.max(limit, 1), 24)];
  const pool = await getDbPool();
  let rows: Record<string, any>[];
  try {
    rows = (await pool.query(SIMILAR_SELECT.replace('__SRC__', src).replace('__KEYWORD_SCORE__', IDF_SCORE), params)).rows;
  } catch {
    rows = (await pool.query(SIMILAR_SELECT.replace('__SRC__', src).replace('__KEYWORD_SCORE__', PLAIN_SCORE), params)).rows;
  }
  return rows.map((r) => ({
    tmdbId: r.tmdbid,
    imdbId: r.imdbid || null,
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

const TYPE_LABEL: Record<string, string> = {
  Stream: 'Stream', Free: 'Free', Rent: 'Rent', Buy: 'Buy',
};

function renderExtras(x: TitleExtras | null): { watch: string; cast: string; trailer: string; director: string } {
  if (!x) return { watch: '', cast: '', trailer: '', director: '' };
  const groups = (['Stream', 'Free', 'Rent', 'Buy'] as const)
    .map((type) => ({ type, items: x.providers.filter((p) => p.type === type) }))
    .filter((g) => g.items.length > 0);
  const watch = groups.length
    ? `<section><h2>Where to watch <small>(${escapeHtml(x.region)})</small></h2>${groups
        .map(
          (g) => `<p class="wg"><strong>${TYPE_LABEL[g.type]}</strong> ${g.items
            .map((p) => {
              const logo = localLogo(p.logoUrl);
              return `<span class="prov">${logo ? `<img src="${escapeHtml(logo)}" alt="" width="24" height="24" loading="lazy">` : ''}${escapeHtml(p.name)}</span>`;
            })
            .join('')}</p>`,
        )
        .join('')}<p class="attr">Streaming data by <a href="https://www.justwatch.com" rel="noopener nofollow" target="_blank">JustWatch</a>. Availability can change.</p></section>`
    : '';
  const cast = x.cast.length
    ? `<section><h2>Cast</h2><ul class="cast">${x.cast
        .map((c) => `<li>${escapeHtml(c.name)}${c.character ? ` <span>as ${escapeHtml(c.character)}</span>` : ''}</li>`)
        .join('')}</ul></section>`
    : '';
  const trailer = x.trailerUrl
    ? `<a class="cta alt" href="${escapeHtml(x.trailerUrl)}" target="_blank" rel="noopener nofollow">▶ Watch trailer</a>`
    : '';
  const director = x.director ? `<p class="facts">Directed by ${escapeHtml(x.director)}</p>` : '';
  return { watch, cast, trailer, director };
}

const PAGE_STYLE = `
body{margin:0;background:#0a0a0a;color:#f5f5f5;font:16px/1.6 Inter,system-ui,sans-serif}
main{max-width:880px;margin:0 auto;padding:24px 16px 64px}
a{color:#ff6b78}.top{display:flex;gap:24px;flex-wrap:wrap}.top img{width:220px;height:auto;border-radius:12px}
h1{margin:.2em 0}h2{margin-top:32px}h2 small{color:#a8a8a8;font-weight:400}.facts{color:#a8a8a8;margin:.3em 0}
ul.sim{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:16px}
ul.sim a{text-decoration:none;color:inherit;font-size:14px;display:block}ul.sim img{display:block;border-radius:8px;margin-bottom:4px;width:100%;height:auto}
.cta{display:inline-block;margin:16px 12px 0 0;padding:10px 18px;background:#e63946;color:#fff;border-radius:999px;text-decoration:none;font-weight:600}
.cta.alt{background:#232323;color:#f5f5f5}
.prov{display:inline-flex;align-items:center;gap:6px;margin:0 10px 6px 8px;padding:2px 10px 2px 4px;background:#1f1f1f;border:1px solid #2a2a2a;border-radius:8px;font-size:14px}
.prov img{border-radius:6px}.wg{margin:.4em 0}.attr{color:#8c8c8c;font-size:13px}
ul.cast{columns:2;padding-left:18px}ul.cast span{color:#8c8c8c}
footer{margin-top:48px;color:#8c8c8c;font-size:13px}footer a{color:#a8a8a8}`;

export const siteFooter = `<footer><a href="/">CineMatch</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a><br>Movie data and images from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</footer>`;

export function renderTitlePage(
  t: TitleRow, similar: SimilarRow[], base: string, extras: TitleExtras | null = null,
): string {
  const tid = titleIdFor(t) ?? '';
  const url = `${base}/title/${tid}`;
  const kind = t.type === 'series' ? 'TV series' : t.type === 'short' ? 'short film' : 'movie';
  const heading = `${t.title}${t.year ? ` (${t.year})` : ''}`;
  const desc = truncateAtWord(t.overview || `${t.title} is a ${t.genres.join(', ').toLowerCase() || kind}.`, 200);
  const poster = posterUrl(t.posterPath, base, 'w500');
  const x = renderExtras(extras);
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
    ...(extras?.director ? { director: { '@type': 'Person', name: extras.director } } : {}),
    ...(extras?.cast?.length ? { actor: extras.cast.slice(0, 5).map((c) => ({ '@type': 'Person', name: c.name })) } : {}),
    ...(extras?.trailerUrl ? { trailer: { '@type': 'VideoObject', name: `${t.title} trailer`, embedUrl: extras.trailerUrl, description: desc, thumbnailUrl: poster || undefined, uploadDate: t.year ? `${t.year}-01-01` : undefined } } : {}),
    ...(t.rating && t.votes
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(t.rating.toFixed(1)), bestRating: 10, ratingCount: t.votes } }
      : {}),
  };

  const sim = similar
    .map((s) => {
      const sid = titleIdFor(s);
      if (!sid) return '';
      return `<li><a href="/title/${sid}">${
        s.posterPath ? `<img src="${escapeHtml(posterUrl(s.posterPath, ''))}" alt="" loading="lazy" width="120" height="180">` : ''
      }<span>${escapeHtml(s.title)}${s.year ? ` (${s.year})` : ''}</span></a></li>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)} - ${kind} details, where to watch &amp; similar picks | CineMatch</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="${t.type === 'series' ? 'video.tv_show' : 'video.movie'}">
<meta property="og:title" content="${escapeHtml(heading)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${escapeHtml(url)}">
${poster ? `<meta property="og:image" content="${escapeHtml(poster)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${safeJsonLd(ld)}</script>
<style>${PAGE_STYLE}</style></head><body><main>
<nav><a href="/">← CineMatch</a></nav>
<div class="top">${poster ? `<img src="${escapeHtml(posterUrl(t.posterPath, '', 'w500'))}" alt="Poster of ${escapeHtml(t.title)}" width="220" height="330">` : ''}
<div style="flex:1;min-width:260px"><h1>${escapeHtml(heading)}</h1>
<p class="facts">${facts.map(escapeHtml).join(' · ')}</p>${x.director}
<p>${escapeHtml(t.overview || 'No synopsis available yet.')}</p>
<a class="cta" href="/">Get picks for your mood</a>${x.trailer}</div></div>
${x.watch}${x.cast}
${sim ? `<h2>More like ${escapeHtml(t.title)}</h2><ul class="sim">${sim}</ul>` : ''}
${siteFooter}
</main></body></html>`;
}

export function renderNotFoundPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Title not found | CineMatch</title></head><body style="background:#0a0a0a;color:#f5f5f5;font-family:system-ui;padding:32px"><h1>We couldn't find that title</h1><p><a style="color:#ff6b78" href="/">Back to CineMatch</a></p></body></html>`;
}

export function renderSitemap(ids: string[], base: string): string {
  const urls = [`<url><loc>${escapeHtml(base)}/</loc></url>`]
    .concat(ids.filter(isTitleId).map((id) => `<url><loc>${escapeHtml(base)}/title/${id}</loc></url>`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function robotsTxt(base: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`;
}

export async function sitemapIds(limit = 20000): Promise<string[]> {
  const { rows } = await (await getDbPool()).query(
    `SELECT tmdbId, imdbId, type FROM movies
      WHERE (imdbId LIKE 'tt%' OR type = 'series') AND adult IS NOT TRUE AND posterPath IS NOT NULL
      ORDER BY popularity DESC NULLS LAST LIMIT $1`,
    [limit],
  );
  return rows
    .map((r) => titleIdFor({ imdbId: r.imdbid || null, tmdbId: r.tmdbid, type: r.type || 'movie' }))
    .filter((id): id is string => id !== null);
}
