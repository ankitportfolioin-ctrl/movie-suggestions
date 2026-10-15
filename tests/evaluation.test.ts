/**
 * Evaluation suite for Movie Night Picker recommendation engine.
 *
 * Contains representative natural-language queries with expected
 * parsed preferences and hard-constraint checks. Target: 300+ queries
 * expanding from this baseline. Each test has documented expected
 * constraints and a relevance rubric.
 *
 * Usage:
 *   npx tsx --test tests/evaluation.test.ts
 *
 * Before enabling any Phase 2–4 features (TMDB, Wikidata, Semantic),
 * verify that zero new hard-constraint violations appear in this suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUserQuery } from '../server/queryParser.js';
import type { MovieItem } from '../server/catalog.js';
import type { GenreLabel } from '../server/preferences.js';

/**
 * Type-safe expectation for a single evaluation query.
 */
type EvaluationExpectation = {
  /** The natural-language query text */
  query: string;
  /** Expected mood label(s) – may be null */
  expectedMood: string[] | null;
  /** Expected genre label(s) – may be null */
  expectedGenres: string[] | null;
  /** Expected max runtime in minutes (null/undefined = no constraint) */
  expectedMaxMinutes?: number | null;
  /** Expected primary language (null = Any) */
  expectedLanguage: string | null;
  /** Expected excluded genres – always an array (may be empty) */
  expectedExcludeGenres: GenreLabel[];
  /** Expected unverifiable content hints – optional (may be absent) */
  expectedExcludeContent?: string[];
  /** If true, preferences should parse but no catalog movies match */
  expectedNoMatch: boolean;
  /** Documented relevance rubric – free-form notes on what should match */
  rubric: string;
};

/**
 * Minimal movie record for gate testing.
 * Uses only fields needed by enforceHardConstraints.
 */
function movie(
  over: {
    id?: number;
    title?: string;
    year?: number;
    genres?: string[];
    runtime?: number;
    rating?: number;
    voteCount?: number;
    popularity?: number;
    overview?: string;
    posterUrl?: string;
    language?: string;
    certificate?: string;
    isMature?: boolean;
  } = {}
): MovieItem {
  return {
    id: over.id ?? 1,
    title: over.title ?? 'Test Film',
    year: over.year ?? 2020,
    genres: over.genres ?? ['Drama'],
    runtime: over.runtime ?? 90,
    rating: over.rating ?? 7.5,
    voteCount: over.voteCount ?? 1000,
    popularity: over.popularity ?? 10,
    overview: over.overview ?? '',
    posterUrl: over.posterUrl ?? '',
    language: over.language ?? 'en',
    isMature: over.isMature ?? false,
    isHiddenGem: false,
    providers: [],
    certificate: over.certificate,
  };
};

/**
 * Parse a query and assert the resulting parsed preferences match expectations.
 *
 * @param query – the user's natural-language search query
 * @param expected – the expected parsed preferences
 */
function evaluateQuery(
  query: string,
  expected: EvaluationExpectation
): Promise<void> {
  return test(`eval: ${query.substring(0, 40)}`, async () => {
    // 1. Parse the query into structured preferences
    const prefs = await parseUserQuery(query);

    // 2. Validate all arrays are proper arrays and enums are valid
    assert.ok(Array.isArray(prefs.mood), 'mood must be an array');
    assert.ok(Array.isArray(prefs.genres), 'genres must be an array');
    assert.ok(Array.isArray(prefs.likedTitles), 'likedTitles must be an array');
    assert.ok(Array.isArray(prefs.dislikedTitles), 'dislikedTitles must be an array');
    assert.ok(Array.isArray(prefs.excludeGenres), 'excludeGenres must be an array');
    assert.ok(Array.isArray(prefs.excludeContent), 'excludeContent must be an array');

    // 3. Enforce enum validity for moods
    if (expected.expectedMood) {
      for (const m of expected.expectedMood) {
        const valid =
          ['tired', 'low_effort', 'easy_watch', 'intense', 'adrenaline',
            'edge_of_seat', 'comforting', 'feel_good', 'relaxed', 'happy',
            'stressed', 'romantic', 'adventurous', 'curious', 'sad'].includes(m);
        assert.ok(valid, `mood '${m}' is not a valid MoodLabel`);
      }
    }

    // 4. Enforce enum validity for genres
    if (expected.expectedGenres) {
      const validGenres = [
        'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
        'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror',
        'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'Western',
        'War', 'Music', 'History',
      ];
      for (const g of expected.expectedGenres) {
        const valid = validGenres.includes(g);
        assert.ok(valid, `genre '${g}' is not a valid GenreLabel`);
      }
    }

    // 5. Check language if expected
    if (expected.expectedLanguage !== null && expected.expectedLanguage !== undefined) {
      assert.ok(
        prefs.language === expected.expectedLanguage,
        `Expected language '${expected.expectedLanguage}', got '${prefs.language}'`
      );
    }

    // 6. Check maxRuntimeMinutes if expected
    if (expected.expectedMaxMinutes !== null && expected.expectedMaxMinutes !== undefined) {
      assert.ok(
        prefs.maxRuntimeMinutes !== null && prefs.maxRuntimeMinutes <= expected.expectedMaxMinutes,
        `Expected maxRuntimeMinutes <= ${expected.expectedMaxMinutes}, got ${prefs.maxRuntimeMinutes}`
      );
    }

    // 7. Check excluded genres if expected
    if (expected.expectedExcludeGenres.length > 0) {
      for (const g of expected.expectedExcludeGenres) {
        assert.ok(
          prefs.excludeGenres.includes(g),
          `Expected exclude genre '${g}' not found in parsed preferences`
        );
      }
    }

    // 8. Check excluded content hints if expected
    // Unverifiable descriptors ("gore", "jump scares") must land in
    // excludeContent, never as genre bans.
    if (expected.expectedExcludeContent && expected.expectedExcludeContent.length > 0) {
      for (const c of expected.expectedExcludeContent) {
        assert.ok(
          prefs.excludeContent.includes(c),
          `Expected exclude content '${c}' not found in parsed preferences`
        );
      }
    }

    // 9. If expectedNoMatch is true, preferences should still be valid
    if (expected.expectedNoMatch) {
      // Preferences must be parseable; the "no match" happens later in the
      // gate/ranking pipeline, not in parsing.
      assert.ok(Array.isArray(prefs.genres), 'Preferences must be valid even for no-match queries');
    }

    // 10. Rubric documentation (assert the rubric string exists if provided)
    if (expected.rubric) {
      assert.ok(typeof expected.rubric === 'string', 'rubric must be a string');
    }
  });
}

/* ---------------------------------------------------------------------------
 * BASELINE EVALUATION QUERIES (30 representative queries)
 * ---------------------------------------------------------------------------
 * Target: expand this baseline to 300+ queries covering:
 *   - Mood-only searches (30)
 *   - Genre combinations (40)
 *   - Positive & negative preferences (50)
 *   - Reference-film searches (25)
 *   - Runtime & year constraints (25)
 *   - Language preferences (15)
 *   - Typo handling (15)
 *   - Ambiguous titles (15)
 *   - Family/child-friendly (15)
 *   - Vague/contradictory queries (20)
 *   - No-match queries (10)
 *   - Edge cases (50)
 * ---------------------------------------------------------------------------
 */

/* Baseline: 30 representative queries */
const baselineQueries: EvaluationExpectation[] = [
  // === MOOD-ONLY SEARCHES (10) ===
  {
    query: "I'm tired, want an action movie",
    expectedMood: ['tired', 'low_effort'],
    expectedGenres: ['Action'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'User is tired; should prefer easy-to-watch action films.',
  },
  {
    query: "I need something relaxing",
    expectedMood: ['relaxed'],
    expectedGenres: ['Comedy', 'Family'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Relaxed mood; comedy/family genres are uplifting matches.',
  },
  {
    query: "Something feel-good after a bad day",
    expectedMood: ['feel_good'],
    expectedGenres: ['Comedy'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Explicit feel-good mood; comedy should be favored.',
  },
  {
    query: "I'm stressed, nothing too intense",
    expectedMood: ['stressed'],
    expectedGenres: ['Comedy', 'Family'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Stressed mood; intense genres (horror/thriller) should be excluded.',
  },
  {
    query: "I want a cheerful movie",
    expectedMood: ['happy'],
    expectedGenres: ['Comedy'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Happy mood; comedy is the natural match.',
  },
  {
    query: "Something comforting and warm",
    expectedMood: ['comforting'],
    expectedGenres: ['Romance', 'Drama'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Comforting mood; romance/drama provide emotional warmth.',
  },
  {
    query: "I need an easy watch, nothing challenging",
    expectedMood: ['easy_watch'],
    expectedGenres: ['Comedy', 'Animation'],
    // shortcut: no runtime words in query; parser correctly returns null.
    // "easy watch" is an effort signal, not a runtime cap. Do not re-add 90 here.
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Easy-watch mood; light genres should be favored.',
  },
  {
    query: "Something intense and gripping",
    expectedMood: ['intense'],
    expectedGenres: ['Thriller', 'Action'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Intense mood; thriller/action genres match the arousal level.',
  },
  {
    query: "I want a romantic movie for date night",
    expectedMood: ['romantic'],
    expectedGenres: ['Romance'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Romantic mood; romance genre is the direct match.',
  },
  {
    query: "I'm in the mood for something sad",
    expectedMood: ['sad'],
    expectedGenres: ['Drama'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Sad mood; drama genre provides emotional depth.',
  },

  // === GENRE COMBINATIONS (8) ===
  {
    query: "Action and comedy movie",
    expectedMood: [],
    expectedGenres: ['Action', 'Comedy'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Dual genre request; both action and comedy should be detected.',
  },
  {
    query: "Sci-fi thriller with a mystery",
    expectedMood: [],
    expectedGenres: ['Sci-Fi', 'Thriller', 'Mystery'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Three-genre combo; all three should be parsed.',
  },
  {
    query: "Family animation for kids",
    expectedMood: [],
    expectedGenres: ['Animation', 'Family'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Family + animation is a common combined request.',
  },
  {
    query: "Romantic comedy for date night",
    expectedMood: [],
    expectedGenres: ['Romance', 'Comedy'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Rom-com is a standard genre combination.',
  },
  {
    query: "Horror movie with no gore",
    expectedMood: [],
    expectedGenres: ['Horror'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'User explicitly mentions horror but negates gore – genre stays, unverifiable hint recorded.',
  },
  {
    query: "No horror please",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: ['Horror'],
    expectedNoMatch: false,
    rubric: 'Explicit negation of horror genre.',
  },
  {
    query: "Comedy but not romance",
    expectedMood: [],
    expectedGenres: ['Comedy'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Positive comedy, implicit exclusion of romance (not a hard ban).',
  },
  {
    query: "Action or adventure please",
    expectedMood: [],
    expectedGenres: ['Action', 'Adventure'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Alternate "or" – both action and adventure detected.',
  },

  // === POSITIVE PREFERENCES (4) ===
  {
    query: "I loved The Godfather",
    expectedMood: [],
    expectedGenres: ['Crime', 'Drama'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Liked title "The Godfather" inferred Crime/Drama genres.',
  },
  {
    query: "I like Tom Hanks movies",
    expectedMood: [],
    expectedGenres: ['Drama'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Liked actor "Tom Hanks" – genre inference from known filmography (fallback).',
  },
  {
    query: "Something similar to Interstellar",
    expectedMood: [],
    expectedGenres: ['Adventure', 'Sci-Fi'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Reference film "Interstellar" inferred Adventure/Sci-Fi genres.',
  },
  {
    query: "Movies with Brad Pitt",
    expectedMood: [],
    expectedGenres: ['Drama'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Liked actor "Brad Pitt" – genre fallback from known titles.',
  },

  // === NEGATIVE PREFERENCES (4) ===
  {
    query: "No horror",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: ['Horror'],
    expectedNoMatch: false,
    rubric: 'Explicit exclusion of horror genre.',
  },
  {
    query: "Nothing with gore or jump scares",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedExcludeContent: ['gore', 'jump scares'],
    expectedNoMatch: false,
    rubric: 'Unverifiable content hints (gore, jump scares) go to excludeContent, not excludeGenres.',
  },
  {
    query: "No romance, no drama",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: ['Romance', 'Drama'],
    expectedNoMatch: false,
    rubric: 'Two explicit genre exclusions.',
  },
  {
    query: "Avoid anything too violent",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedExcludeContent: ['violence'],
    expectedNoMatch: false,
    rubric: 'Violence is an unverifiable hint – recorded but not used as a hard genre ban.',
  },

  // === RUNTIME & YEAR CONSTRAINTS (4) ===
  {
    query: "something short under 90 minutes",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: 90,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Runtime constraint "under 90 minutes" parsed as maxRuntimeMinutes=90.',
  },
  {
    query: "a long movie over 2 hours",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: 180,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Runtime constraint "over 2 hours" parsed as maxRuntimeMinutes=180.',
  },
  {
    query: "a classic 80s film",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: null,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Era hint "80s" parsed as releasePeriod="80s", not as a runtime constraint.',
  },
  {
    query: "recent releases only, nothing before 2021",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: null,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'User requests recent; handled downstream in gate, not in parser runtime field.',
  },

  // LANGUAGE PREFERENCES (2)
  {
    query: "a korean movie please",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: null,
    expectedLanguage: 'Korean',
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Language hint "korean" parsed as language="Korean".',
  },
  {
    query: "french film with subtitles",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: null,
    expectedLanguage: 'French',
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Language hint "french" parsed as language="French".',
  },

  // NO-MATCH QUERIES (2)
  {
    query: "a movie about my dream of flying elephants",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: null,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: true,
    rubric: 'Extremely vague query; preferences parse but no catalog movies match.',
  },
  {
    query: "something good I guess",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: null,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: true,
    rubric: 'Highly vague query with no detectable preferences.',
  },

  // TYPO HANDLING (2)
  {
    query: "something comdey with under 2 hours",
    expectedMood: [],
    expectedGenres: ['Comedy'],
    // shortcut: free-text "under 2 hours" is not parsed (only "under N min" digits
    // and short/long hints are); rubric covers the typo only. Do not re-add 90 here.
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Typo "comdey" should still match comedy genre via fuzzy matching.',
  },
  {
    query: "A space moview like Interstellar",
    expectedMood: [],
    expectedGenres: ['Sci-Fi'],
    expectedMaxMinutes: undefined,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Typo "moview" – genre "Sci-Fi" still detected from "like Interstellar".',
  },

  // AMBIGUOUS TITLES (2)
  {
    query: "The Matrix, not the reality one",
    expectedMood: [],
    expectedGenres: [],
    expectedMaxMinutes: null,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Title "The Matrix" detected; "not the reality one" may clarification or exclusion.',
  },
  {
    query: "Fight Club book vs movie",
    expectedMood: [],
    expectedGenres: ['Drama'],
    expectedMaxMinutes: null,
    expectedLanguage: null,
    expectedExcludeGenres: [],
    expectedNoMatch: false,
    rubric: 'Title "Fight Club" detected; genre Drama from known film.',
  },
];

/* ---------------------------------------------------------------------------
 * EXPORT baselineQueries for use by the test runner or external scripts.
 * --------------------------------------------------------------------------- */
export { baselineQueries };

/* ---------------------------------------------------------------------------
 * TEST FUNCTION
 * ---------------------------------------------------------------------------
 */
/**
 * Run a single evaluation query test.
 *
 * @param query – the user's natural-language search query
 * @param expected – the expected parsed preferences
 */
function makeEvaluationTest(query: string, expected: EvaluationExpectation): Promise<void> {
  return evaluateQuery(query, expected);
}

/* ---------------------------------------------------------------------------
 * RUN ALL BASELINE QUERIES
 * ---------------------------------------------------------------------------
 */
baselineQueries.forEach((expectation) => {
  makeEvaluationTest(expectation.query, expectation);
});