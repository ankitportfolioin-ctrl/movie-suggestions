/**
 * Final backstop: enforceHardConstraints(movies, constraints).
 *
 * Runs LAST (after selection, before AI/watchmode) so no ladder rung,
 * fallback, or enrichment path can smuggle a violating title into the
 * response. It only ever REMOVES titles; every removal class is disclosed
 * in `relaxed` notices computed from the DIFF between what was requested
 * and what survived — never from parser signals.
 *
 * Maturity comes from the title's minAge (TMDB-derived, 0/6/12/16/18)
 * when known: mature OFF excludes minAge >= 16, Family with kids allows
 * minAge <= 6. When minAge is unknown the certificate is the fallback
 * (mature-OFF excludes MATURE_CERTS; Family requires a family-safe
 * certificate AND a Family/Animation genre), then the catalog flag.
 */

export interface GateConstraints {
  /** Requested runtime cap in minutes (Infinity = no cap). */
  maxMinutes: number;
  maxRuntimeLabel: string;
  /** Requested language codes ([] = Any). */
  langCodes: string[];
  highlyRated: boolean;
  recent: boolean;
  classics: boolean;
  audience: string;
  matureAllowed: boolean;
  /** Requested media kinds (default ['movie']). [] = any. */
  types?: string[];
  /** Series only: max season count (1 = miniseries). null/absent = no limit. */
  seasonsMax?: number | null;
}

export interface GateMovie {
  id: number;
  title: string;
  year: number;
  genres: string[];
  runtime: number;
  rating: number;
  language: string;
  /** OMDb `Rated` value as served (may be '', 'N/A', 'Not Rated'). */
  certificate?: string;
  /** TMDB-derived minimum age (0, 6, 12, 16 or 18) when known. */
  minAge?: number | null;
  /** Catalog hand flag: fallback only when the certificate is unknown. */
  isMature?: boolean;
  /** OMDb `Type` field when known. */
  mediaType?: string;
  /** Stored media kind: 'movie' | 'short' | 'series'. */
  type?: string;
  /** Stored season count (series). */
  seasons?: number;
}

export interface GateResult<T extends GateMovie> {
  movies: T[];
  /** Disclosure lines derived from requested-vs-surviving diff. */
  relaxed: string[];
}

/** Certificates treated as adult-only. */
export const MATURE_CERTS = new Set(['R', 'NC-17', 'TV-MA', 'X', 'A', '18', '18+']);

/** Certificates allowed for Family with kids. Unknown = excluded. */
const FAMILY_CERTS = new Set(['G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG', 'U']);

export function normalizeCert(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.trim().toUpperCase();
  if (!v || v === 'N/A' || v === 'NOT RATED' || v === 'UNRATED') return '';
  return v;
}

function isFamily(audience: string): boolean {
  return audience === 'Family with kids';
}

/**
 * Media kind for gating: stored `type` wins; otherwise OMDb `mediaType`
 * (anything non-movie counts as series); undefined = unknown.
 */
function gateType(m: GateMovie): string | undefined {
  if (m.type === 'movie' || m.type === 'short' || m.type === 'series') return m.type;
  if (m.mediaType === 'movie') return 'movie';
  if (m.mediaType) return 'series';
  return undefined;
}

/**
 * Family/Animation rule for titles whose minAge is unknown: only genuine
 * kids' genres pass, and never Horror/Crime/Thriller.
 */
function isKidGenre(genres: string[] | undefined): boolean {
  const g = genres || [];
  if (g.includes('Horror') || g.includes('Crime') || g.includes('Thriller') || g.includes('War')) return false;
  return g.includes('Family') || g.includes('Animation');
}

export function enforceHardConstraints<T extends GateMovie>(
  movies: T[],
  constraints: GateConstraints
): GateResult<T> {
  const relaxed: string[] = [];
  const family = isFamily(constraints.audience);
  const wantedTypes = constraints.types ?? ['movie'];
  const seasonsMax = constraints.seasonsMax ?? null;

  let removedRuntime = 0;
  let removedLanguage = 0;
  let removedRating = 0;
  let removedRecent = 0;
  let removedClassics = 0;
  let removedMaturity = 0;
  let removedType = 0;
  let removedSeasons = 0;

  const kept = movies.filter((m) => {
    // Type: only the requested kinds pass. Unknown kinds fail closed unless
    // movies are still allowed (pre-type catalog rows read as movies).
    if (wantedTypes.length > 0) {
      const t = gateType(m);
      if (t === undefined ? !wantedTypes.includes('movie') : !wantedTypes.includes(t)) {
        removedType += 1;
        return false;
      }
    }
    if (seasonsMax !== null && !(typeof m.seasons === 'number' && m.seasons <= seasonsMax)) {
      removedSeasons += 1;
      return false;
    }
    // Runtime: unknown runtime fails a finite cap (absence of data is
    // not a license to breach an explicit limit).
    if (Number.isFinite(constraints.maxMinutes)) {
      if (!m.runtime || m.runtime <= 0 || m.runtime > constraints.maxMinutes) {
        removedRuntime += 1;
        return false;
      }
    }
    // Language: original/primary language must match.
    if (constraints.langCodes.length > 0 && !constraints.langCodes.includes(m.language)) {
      removedLanguage += 1;
      return false;
    }
    // Rating floor.
    if (constraints.highlyRated && !(m.rating >= 7.0)) {
      removedRating += 1;
      return false;
    }
    // Release period (recent = last 5 calendar years, matches retrieval).
    if (constraints.recent && !(m.year >= new Date().getFullYear() - 5)) {
      removedRecent += 1;
      return false;
    }
    if (constraints.classics && !(m.year < 2000)) {
      removedClassics += 1;
      return false;
    }
    // Maturity: minAge is source of truth when known; otherwise the
    // certificate, then the catalog flag (conservative).
    const cert = normalizeCert(m.certificate);
    const age = typeof m.minAge === 'number' ? m.minAge : null;
    if (family) {
      if (age !== null) {
        // Known age: kids allowed only at 6 or under.
        if (age > 6) {
          removedMaturity += 1;
          return false;
        }
      } else if (cert === '' || !FAMILY_CERTS.has(cert) || !isKidGenre(m.genres)) {
        // Unknown age fails closed: family-safe certificate AND the
        // Family/Animation genre rule, never Horror/Crime/Thriller.
        removedMaturity += 1;
        return false;
      }
    } else if (!constraints.matureAllowed) {
      if (age !== null) {
        // Mature OFF excludes 16+. An EXPLICIT language ask ("Kannada movie")
        // raises the boundary to 18: the viewer asked for that industry's
        // catalog, and ingest cert-buckets 15/17 as 16. Family is unaffected.
        const cap = constraints.langCodes.length > 0 ? 18 : 16;
        if (age >= cap) {
          removedMaturity += 1;
          return false;
        }
      } else if (cert !== '') {
        if (MATURE_CERTS.has(cert)) {
          removedMaturity += 1;
          return false;
        }
        if (m.isMature === true) {
          console.warn(
            `[gate] certificate ${cert} disagrees with catalog mature flag for "${m.title}" — certificate wins, kept`
          );
        }
      } else {
        if (m.isMature === true) {
          removedMaturity += 1;
          return false;
        }
        console.warn(`[gate] unknown certificate for "${m.title}" with mature OFF — allowed, please verify`);
      }
    }
    return true;
  });

  // Deduplicate: same id, or same normalized title+year from merged sources.
  const unique = new Map<string, T>();
  for (const m of kept) {
    const normTitle = m.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `t:${normTitle}_${m.year}`;
    if (!unique.has(`id:${m.id}`) && ![...unique.values()].some((o) => {
      const ot = o.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      return `t:${ot}_${o.year}` === key;
    })) {
      unique.set(`id:${m.id}`, m);
    }
  }
  const final = [...unique.values()];

  if (removedRuntime > 0) {
    relaxed.push(
      `Removed ${removedRuntime} title${removedRuntime === 1 ? '' : 's'} over your ${constraints.maxRuntimeLabel} limit.`
    );
  }
  if (removedLanguage > 0) relaxed.push(`Removed ${removedLanguage} title${removedLanguage === 1 ? '' : 's'} in another language.`);
  if (removedRating > 0) relaxed.push(`Removed ${removedRating} title${removedRating === 1 ? '' : 's'} rated below 7.0.`);
  if (removedRecent > 0) relaxed.push(`Removed ${removedRecent} title${removedRecent === 1 ? '' : 's'} released before 2021.`);
  if (removedClassics > 0) relaxed.push(`Removed ${removedClassics} title${removedClassics === 1 ? '' : 's'} from 2000 or later.`);
  if (removedMaturity > 0) {
    relaxed.push(
      family
        ? `Removed ${removedMaturity} title${removedMaturity === 1 ? '' : 's'} outside family-safe ratings.`
        : `Removed ${removedMaturity} title${removedMaturity === 1 ? '' : 's'} with adult ratings.`
    );
  }
  if (removedType > 0) {
    relaxed.push(
      wantedTypes.length === 1 && wantedTypes[0] !== 'movie'
        ? `Removed ${removedType} title${removedType === 1 ? '' : 's'} of the wrong kind — you asked for ${wantedTypes[0] === 'series' ? 'series' : 'short films'}.`
        : wantedTypes.length > 1
          ? `Removed ${removedType} title${removedType === 1 ? '' : 's'} outside your chosen types.`
          : `Removed ${removedType} non-movie result${removedType === 1 ? '' : 's'}.`
    );
  }
  if (removedSeasons > 0) {
    relaxed.push(`Removed ${removedSeasons} series longer than a miniseries.`);
  }
  if (final.length === 0 && movies.length > 0) {
    relaxed.push('Nothing left after enforcing your filters — try widening the runtime or genres.');
  }

  return { movies: final, relaxed };
}
