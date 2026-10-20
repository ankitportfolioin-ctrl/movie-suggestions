/**
 * The single natural-language search pipeline, shared by /api/search in BOTH
 * server.ts and api/index.ts. Parse -> filters -> rank -> gate -> age.
 *
 * Honesty rules enforced here (never silently relax):
 *  - No filter collapse: an empty/narrow pool returns what exists + a notice,
 *    never unrelated padding (D08).
 *  - Kid-safe queries switch to family mode with strict age gating (D04).
 *  - No stated mood = Neutral: no hidden Relaxed/Animation bias (D05).
 *  - Series asks are series searches; if nothing matches, empty + notice,
 *    never movies pretending to be series matches (D12).
 *  - Reference titles only claim "using X" when they actually changed the
 *    ranking (D10).
 *  - Exact whole-query title short-circuits to that title, or an honest
 *    "not in our catalog" (D11).
 */
import { parseNote } from './noteParser.js';
import type { NoteSignals } from './noteParser.js';
import {
  loadDbCandidates, loadReferenceAnchors, rankGateMovies, ensureMinAge, diagnoseEmptyPool,
} from './dbMovies.js';
import type { DbFilters, DbItem } from './dbMovies.js';
import { runtimeCap, LANGUAGE_CODES, MOOD_GENRES, normalizeTitle, NOTE_TITLE_GENRES } from './omdb.js';
import { themeSimilarity } from './ranking.js';
import { FALLBACK_CATALOG } from './catalog.js';

export type SearchedMovie = DbItem & { fitScore: number; reason: string; ratingNote?: string };

export interface NaturalSearchResult {
  movies: SearchedMovie[];
  parsed: {
    mood: string;
    genres: string[];
    excludeGenres: string[];
    runtimeHint?: 'short' | 'long';
    languageHints: string[];
    eraHint?: 'recent' | 'classics';
    wantsSeries: boolean;
    audienceSafe: boolean;
    unsupportedGenres: string[];
    yearMin?: number;
    yearMax?: number;
  };
  notices: string[];
}

const INTENT_WORDS =
  /\b(movie|film|watch|watching|something|anything|find|suggest|recommend|looking|list|show|about)\b/;

function parsedFor(note: NoteSignals, mood: string, genres: string[]): NaturalSearchResult['parsed'] {
  return {
    mood, genres,
    excludeGenres: note.excludeGenres,
    runtimeHint: note.runtimeHint,
    languageHints: note.languageHints,
    eraHint: note.eraHint,
    wantsSeries: note.wantsSeries === true,
    audienceSafe: note.audienceSafe === true,
    unsupportedGenres: note.unsupportedGenres,
    yearMin: note.yearMin,
    yearMax: note.yearMax,
  };
}

/**
 * D11: the whole query is a title the catalog has → return exactly that
 * title. Not found → "not in our catalog". Only fires when the parser found
 * NO other signals (genres/moods/filters/references) and the query has no
 * intent words, so "joker movie" never hijacks the title path.
 */
async function tryExactTitle(
  query: string, note: NoteSignals, excludeIds: number[],
): Promise<NaturalSearchResult | null> {
  const trimmed = query.trim();
  if (!trimmed || INTENT_WORDS.test(trimmed.toLowerCase())) return null;
  const hasOtherSignal =
    note.genres.length > 0 || note.moods.length > 0 || note.languageHints.length > 0 ||
    note.referenceTitles.length > 0 || note.excludedPeople.length > 0 ||
    note.runtimeMinMinutes !== undefined || note.runtimeMaxMinutes !== undefined ||
    note.runtimeHint !== undefined || note.wantsSeries === true || note.audienceSafe === true ||
    note.yearMin !== undefined || note.yearMax !== undefined ||
    note.lovedTitles.length > 0 || note.themeKeywords.length > 0;
  if (hasOtherSignal) return null;
  const norm = normalizeTitle(trimmed);
  if (!norm) return null;

  const rows = await loadReferenceAnchors([trimmed]);
  const scored = rows
    .filter((m) => !excludeIds.includes(m.tmdbId))
    .map((m) => ({ m, hit: m.title.toLowerCase() === trimmed.toLowerCase() ? 1 : 0 }))
    .sort((a, b) => b.hit - a.hit);
  if (scored.length > 0) {
    const pick = scored[0].m;
    return {
      movies: [{
        ...pick,
        fitScore: 100,
        reason: `Exact catalog match for "${pick.title}".`,
      }],
      parsed: parsedFor(note, 'Neutral', []),
      notices: [`Exact catalog match: "${pick.title}" (${pick.year}).`],
    };
  }
  // DB unreachable fallback: the built-in catalog, same exact rule.
  const fb = FALLBACK_CATALOG.find((m) => normalizeTitle(m.title) === norm);
  if (fb) {
    return {
      movies: [{
        ...fb, tmdbId: fb.id, minAge: null,
        fitScore: 100, reason: `Exact catalog match for "${fb.title}".`,
      }],
      parsed: parsedFor(note, 'Neutral', []),
      notices: [`Exact catalog match: "${fb.title}".`],
    };
  }
  return {
    movies: [],
    parsed: parsedFor(note, 'Neutral', []),
    notices: [`"${trimmed}" is not in our catalog yet.`],
  };
}

export async function runNaturalSearch(
  query: string, excludeIds: number[] = [],
): Promise<NaturalSearchResult> {
  const t = Date.now();
  const mark = (stage: string) => `${Date.now() - t}ms ${stage}`;
  const note = parseNote(query);
  const mood = note.moods[0] || 'Neutral';
  const genres = note.genres.length > 0 ? note.genres : ['Surprise me'];
  const audience = note.audienceSafe ? 'Family with kids' : 'Just me';
  const parsed = parsedFor(note, mood, genres);

  if (note.contradiction) return { movies: [], parsed, notices: [note.contradiction] };

  const exact = await tryExactTitle(query, note, excludeIds);
  if (exact) {
    console.log(`[search] ${mark('exact-title')} q="${query}"`);
    return exact;
  }

  const mediaType = note.wantsSeries ? 'series' : 'movie';
  const maxRuntime = note.runtimeHint === 'short' ? 'Under 90 min' : '';
  const maxMinutes = note.runtimeMaxMinutes ?? runtimeCap(maxRuntime);
  const langCodes = note.languageHints
    .map((l) => LANGUAGE_CODES[l]).filter(Boolean);
  const currentYear = new Date().getFullYear();
  const recent = note.eraHint === 'recent';
  const classics = note.eraHint === 'classics';
  const wantedGenres = genres.filter((g) => g !== 'Surprise me');
  const moodGenreList = MOOD_GENRES[mood] || [];

  const filters: DbFilters = {
    // D12: series asks search series; everything else is movies.
    types: [mediaType],
    genres: wantedGenres, excludeGenres: note.excludeGenres, languages: langCodes,
    runtimeMin: note.runtimeMinMinutes ?? null,
    runtimeMax: Number.isFinite(maxMinutes) ? maxMinutes : null,
    yearMin: note.yearMin ?? (recent ? currentYear - 5 : null),
    yearMax: note.yearMax ?? (classics ? 1999 : null),
    ratingFloor: note.wantsHighlyRated ? 7.0 : null,
    seasonsMax: null,
    audience, matureAllowed: false,
    excludeIds, limit: 500,
  };
  const { items, source } = await loadDbCandidates(filters);
  console.log(`[search] ${mark(`db(${items.length}, ${source})`)} q="${query}"`);
  if (items.length === 0) {
    const notices: string[] = [];
    if (note.wantsSeries) {
      notices.push('Series are not available for that search yet — showing no result rather than movies pretending to be series.');
    }
    const cause = await diagnoseEmptyPool(filters);
    notices.push(cause ?? 'Nothing matches all of those filters together — try removing one constraint.');
    console.log(`[search] ${mark('total')} q="${query}"`);
    return { movies: [], parsed, notices };
  }

  // Reference titles ("like Arrival"): anchored on their own overviews,
  // excluded from the picks. D10: the "using X" notice only appears when the
  // reference actually moved the ranking.
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
  // D10: a loaded reference defines the GENRES the user wants — narrow the
  // pool to them (so every pick shares some genre DNA) instead of letting
  // genre diversity dilute the similarity anchors.
  let candidates = items.filter((m) => !referencedFilms.has(m.id));
  const extraNotices: string[] = [];
  if (referencedFilms.size > 0 && wantedGenres.length === 0) {
    const anchor = [...referencedFilms.values()][0];
    // The anchor's GENRES are what the user wants. Rank with all of them;
    // narrow the pool to the most SPECIFIC one (Drama/Adventure/Romance/
    // Family say nothing about intent), seeded with the anchor's own
    // language. Fall back layer by layer — never return an empty pool that
    // the wider one could have filled.
    const GENERIC = new Set(['Drama', 'Romance', 'Adventure', 'Family']);
    const primary = anchor.genres.find((g) => !GENERIC.has(g)) || anchor.genres[0];
    const seedLangs = filters.languages.length > 0 ? [] : (
      anchor.language ? [anchor.language] : []);
    const loadNarrow = async (langs: string[]) => {
      const { items: narrowed } = await loadDbCandidates(
        { ...filters, genres: primary ? [primary] : [], languages: langs },
      );
      return narrowed.filter((m) => !referencedFilms.has(m.id));
    };
    if (primary) {
      const names = note.referenceTitleNames.join(', ');
      const withLang = await loadNarrow([...filters.languages, ...seedLangs]);
      if (withLang.length > 0) {
        candidates = withLang;
        extraNotices.push(
          `Showing titles like ${names} — ${primary}${seedLangs.length > 0 ? ` in its original language` : ''}.`,
        );
      } else {
        const genreOnly = await loadNarrow(filters.languages);
        if (genreOnly.length > 0) {
          candidates = genreOnly;
          extraNotices.push(`Showing titles like ${names} — ${primary}.`);
        }
      }
    }
  }
  const lovedSeeds = note.lovedTitles.flatMap((t) => NOTE_TITLE_GENRES[t] || []);
  const refSeedGenres = [...new Set(
    [...referencedFilms.values()].flatMap((m) => m.genres),
  )];
  // Loved names carry known genres even without a loaded catalog row.
  const seedGenres = [...new Set([...refSeedGenres, ...lovedSeeds])];
  const quizGenres = wantedGenres.length > 0 ? [...wantedGenres, ...seedGenres]
    : (seedGenres.length > 0 ? seedGenres : moodGenreList); // neutral mood → []
  const { movies: ranked, relaxed } = rankGateMovies(candidates, {
    quizGenres, noteGenres: [], moodGenres: moodGenreList, mood, themeRefs,
    maxMinutes, languageSpecific: langCodes.length > 0,
    preferHiddenGems: false, mentionedTitles: note.lovedTitles,
  }, {
    maxMinutes, maxRuntimeLabel: maxRuntime, langCodes,
    highlyRated: note.wantsHighlyRated === true, recent, classics,
    audience, matureAllowed: false,
    types: [mediaType], seasonsMax: null,
  }, 3);
  const { movies: picks, notices: ageNotices } = await ensureMinAge(
    ranked, audience, false, [mediaType]);
  // D14/D04 data repair: minAge is the source of truth; ingest certificates
  // country-hop ("15", "R15+", "U/A 13+", "K-18"). Replace raw strings with
  // the watch-level label they agree with (card labels read minAge anyway).
  for (const p of picks) {
    if (typeof p.minAge === 'number') {
      p.certificate = p.minAge <= 6 ? 'All ages' : p.minAge <= 12 ? '12+'
        : p.minAge <= 15 ? '15+' : p.minAge <= 16 ? '16+' : '18+';
    }
  }

  const notices: string[] = [...extraNotices];
  if (note.excludeGenres.length > 0) notices.push(`Excluding ${note.excludeGenres.join(', ')}`);
  for (const u of note.unsupportedGenres) {
    notices.push(`"${u}" is not a filterable tag in our catalog — picking by your other filters instead.`);
  }
  if (note.excludedPeople.length > 0) {
    notices.push(
      `We can't filter by cast yet, so "without ${note.excludedPeople.join(', ')}" could not be applied.`,
    );
  }
  notices.push(...relaxed, ...ageNotices);
  if (note.referenceTitleNames.length > 0) {
    if (themeRefs.length === 0) {
      notices.push(
        `Couldn't load ${note.referenceTitleNames.join(', ')} for similarity matching — these picks use your other filters instead.`,
      );
    } else if (picks.some((m) => themeSimilarity(m.overview, themeRefs) > 0)) {
      notices.push(`Using ${note.referenceTitleNames.join(', ')} as your similarity reference.`);
    } else {
      notices.push(
        `${note.referenceTitleNames.join(', ')} didn't change your picks — showing the best matches for your other filters instead.`,
      );
    }
  }
  // D08: fewer than three matches is disclosed, never padded.
  if (picks.length > 0 && picks.length < 3) {
    notices.push(
      langCodes.length > 0
        ? `Only ${picks.length} ${note.languageHints.join('/')} title${picks.length === 1 ? '' : 's'} matched — showing what exists, no unrelated padding.`
        : `Only ${picks.length} title${picks.length === 1 ? '' : 's'} matched your filters — showing those, nothing padded in.`,
    );
  }
  if (picks.length === 0) {
    const cause = await diagnoseEmptyPool(filters);
    notices.push(cause ?? 'Nothing matches all of those filters together — try removing one constraint.');
  }
  console.log(`[search] ${mark('total')} q="${query}"`);
  return { movies: picks, parsed, notices };
}
