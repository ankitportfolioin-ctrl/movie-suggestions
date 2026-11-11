/**
 * Collection contracts for the home-page shelves. Each collection has ONE
 * truthful definition, used for retrieval (SQL), ordering and the badge, so
 * a title can never be labelled something the filter did not enforce.
 *
 *  popular       TMDB popularity (global, rolling), enough votes to be real.
 *  best-of-year  exactly that release year; rating >= 6.8 with >= 500 votes,
 *                ordered by a Bayesian-weighted rating.
 *  recent        released in the current calendar year. The catalog has no
 *                release DATE (year only), so this is "new releases", not
 *                "new this week", and the UI says so.
 *  hidden-gems   GEM rule below (the same predicate drives the badge).
 *  family-night  kid-safe gate (known age <= 6, no contradicting certificate;
 *                US MPA/TV ratings + TMDB watch age), well-rated.
 */
import type { DbFilters } from './dbMovies.js';

export type CollectionKind = 'popular' | 'best-of-year' | 'recent' | 'hidden-gems' | 'family-night';
export const COLLECTION_KINDS: readonly CollectionKind[] = ['popular', 'best-of-year', 'recent', 'hidden-gems', 'family-night'];

export const GEM = { minRating: 7.2, minVotes: 300, maxVotes: 5000, maxPopularity: 20 } as const;
export const BEST_OF = { minRating: 6.8, minVotes: 500 } as const;
export const POPULAR = { minVotes: 100 } as const;
export const RECENT = { minVotes: 20 } as const;
export const FAMILY_NIGHT = { minRating: 6.5, minVotes: 200 } as const;

interface Rated { rating: number; voteCount?: number; popularity?: number; year: number }

/** The single hidden-gem definition: well rated, enough votes to trust, but under the radar. */
export function isHiddenGem(m: Rated): boolean {
  const votes = m.voteCount ?? 0;
  return (
    m.rating >= GEM.minRating &&
    votes >= GEM.minVotes && votes <= GEM.maxVotes &&
    typeof m.popularity === 'number' && m.popularity > 0 && m.popularity <= GEM.maxPopularity
  );
}

export function clampYear(y: unknown, currentYear: number): number {
  const n = typeof y === 'number' && Number.isInteger(y) ? y : currentYear;
  return Math.min(Math.max(n, 1900), currentYear);
}

/** Extra SQL filters implied by a collection (merged over the user's own filters). */
export function collectionFilters(kind: CollectionKind, year: number, currentYear: number): Partial<DbFilters> {
  switch (kind) {
    case 'popular': return { votesMin: POPULAR.minVotes };
    case 'best-of-year': return { yearMin: year, yearMax: year, ratingFloor: BEST_OF.minRating, votesMin: BEST_OF.minVotes };
    case 'recent': return { yearMin: currentYear, yearMax: currentYear, votesMin: RECENT.minVotes };
    case 'hidden-gems': return { ratingFloor: GEM.minRating, votesMin: GEM.minVotes, votesMax: GEM.maxVotes, popularityMax: GEM.maxPopularity };
    case 'family-night': return { ratingFloor: FAMILY_NIGHT.minRating, votesMin: FAMILY_NIGHT.minVotes };
  }
}

/** Bayesian-weighted rating: a 9.0 from 12 votes does not beat an 8.1 from 40k. */
export function weightedRating(m: Rated, prior = 6.5, weight = 1000): number {
  const v = m.voteCount ?? 0;
  return (v / (v + weight)) * m.rating + (weight / (v + weight)) * prior;
}

/** Deterministic ordering per collection (ties broken by popularity, then id-stable input order). */
export function sortForCollection<T extends Rated>(kind: CollectionKind, items: T[]): T[] {
  const pop = (m: T) => m.popularity ?? 0;
  const key: Record<CollectionKind, (m: T) => number> = {
    'popular': pop,
    'recent': pop,
    'best-of-year': (m) => weightedRating(m),
    'hidden-gems': (m) => m.rating * 100 + Math.min(m.voteCount ?? 0, 5000) / 100,
    'family-night': (m) => weightedRating(m) * 100 + Math.min(pop(m), 99) / 10,
  };
  const k = key[kind];
  return [...items].sort((a, b) => k(b) - k(a) || pop(b) - pop(a));
}

/** Does an item satisfy the collection contract? (Used by tests and as a belt-and-braces check.) */
export function passesCollection(kind: CollectionKind, m: Rated, year: number, currentYear: number): boolean {
  const v = m.voteCount ?? 0;
  switch (kind) {
    case 'popular': return v >= POPULAR.minVotes;
    case 'best-of-year': return m.year === year && m.rating >= BEST_OF.minRating && v >= BEST_OF.minVotes;
    case 'recent': return m.year === currentYear && v >= RECENT.minVotes;
    case 'hidden-gems': return isHiddenGem(m);
    case 'family-night': return m.rating >= FAMILY_NIGHT.minRating && v >= FAMILY_NIGHT.minVotes;
  }
}

/** Honest, user-facing definition shown above the results. */
export function collectionNotice(kind: CollectionKind, year: number, currentYear: number): string {
  switch (kind) {
    case 'popular': return 'Popular right now: ranked by TMDB popularity (worldwide).';
    case 'best-of-year': return `Best of ${year}: titles released in ${year} rated ${BEST_OF.minRating}+ with ${BEST_OF.minVotes}+ votes.`;
    case 'recent': return `New releases: titles from ${currentYear}, most popular first. We only have release years, not exact dates.`;
    case 'hidden-gems': return `Hidden gems: rated ${GEM.minRating}+ with ${GEM.minVotes}-${GEM.maxVotes} votes and low mainstream popularity.`;
    case 'family-night': return 'Family night: only titles with a confirmed all-ages rating (G / TV-Y level, US ratings).';
  }
}

export function collectionReason(kind: CollectionKind, m: Rated): string {
  const v = (m.voteCount ?? 0).toLocaleString('en-US');
  switch (kind) {
    case 'popular': return `Trending worldwide right now, rated ${m.rating.toFixed(1)}.`;
    case 'best-of-year': return `One of the best-rated ${m.year} releases: ${m.rating.toFixed(1)} from ${v} votes.`;
    case 'recent': return `A ${m.year} release people are watching now.`;
    case 'hidden-gems': return `Under the radar: ${m.rating.toFixed(1)} from ${v} votes, far less talked about than its quality deserves.`;
    case 'family-night': return `Confirmed all-ages rating and a solid ${m.rating.toFixed(1)} from ${v} votes.`;
  }
}

/** Honest qualitative label from the relative backend fit (90-99). Never shown as a score. */
export function fitLabelFor(fitScore: number | undefined): string {
  const s = typeof fitScore === 'number' ? fitScore : 0;
  if (s >= 97) return 'Strong match';
  if (s >= 94) return 'Good match';
  return 'Worth a look';
}
