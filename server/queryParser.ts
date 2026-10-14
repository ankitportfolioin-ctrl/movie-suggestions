/**
 * Natural-language query parser with LLM + deterministic fallback.
 *
 * Converts free-text queries like "I'm tired, want an action movie, and I like The Godfather"
 * into the validated ParsedPreferences structure. Uses Gemini when configured,
 * otherwise deterministic keyword rules.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { parseNote, NoteSignals } from './noteParser.js';
import {
  ParsedPreferences,
  ResolvedTitle,
  validatePreferences,
  VALID_MOODS,
  VALID_GENRES,
  VALID_LANGUAGES,
  VALID_ERAS,
  VALID_INTENSITIES,
  VALID_WATCH_EFFORTS,
  MoodLabel,
  GenreLabel,
  LanguageLabel,
  EraLabel,
  IntensityLevel,
  WatchEffortLevel,
} from './preferences.js';

// LLM output schema for structured JSON parsing
const PARSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    mediaType: { type: Type.STRING, enum: ['movie', 'tv'] },
    mood: { type: Type.ARRAY, items: { type: Type.STRING } },
    genres: { type: Type.ARRAY, items: { type: Type.STRING } },
    likedTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
    dislikedTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
    mustInclude: { type: Type.ARRAY, items: { type: Type.STRING } },
    excludeGenres: { type: Type.ARRAY, items: { type: Type.STRING } },
    excludeContent: { type: Type.ARRAY, items: { type: Type.STRING } },
    language: { type: Type.STRING, nullable: true },
    region: { type: Type.STRING, nullable: true },
    maxRuntimeMinutes: { type: Type.INTEGER, nullable: true },
    releasePeriod: { type: Type.STRING, nullable: true },
    intensity: { type: Type.STRING, nullable: true },
    watchEffort: { type: Type.STRING, nullable: true },
    clarificationNeeded: { type: Type.BOOLEAN },
    clarificationQuestion: { type: Type.STRING, nullable: true },
  },
  required: ['mediaType', 'mood', 'genres', 'likedTitles', 'dislikedTitles', 'mustInclude', 'excludeGenres', 'excludeContent', 'language', 'region', 'maxRuntimeMinutes', 'releasePeriod', 'intensity', 'watchEffort', 'clarificationNeeded', 'clarificationQuestion'],
} as const;

const PARSE_SYSTEM_PROMPT = `You are a movie/TV preference parser. Convert the user's natural language query into a structured preference object.

RULES:
- Output ONLY valid JSON matching the schema.
- Use ONLY the controlled values listed below. Unknown values → null/empty array.
- "likedTitles" and "dislikedTitles" are FREE-TEXT title strings the user mentioned (e.g., "The Godfather", "Breaking Bad"). Do NOT resolve to IDs here — that happens later.
- "excludeContent" captures unverifiable descriptors like "gore", "jump scares", "slow pacing" — things we cannot filter by metadata.
- "clarificationNeeded": true if the query has conflicting or ambiguous preferences (e.g., "tired but intense action").
- "clarificationQuestion": a concise follow-up question when clarificationNeeded is true.
- Media type defaults to "movie" unless the query explicitly mentions TV/shows/series.

CONTROLLED VALUES:
mood: ${VALID_MOODS.join(', ')}
genres: ${VALID_GENRES.join(', ')}
language: ${VALID_LANGUAGES.join(', ')}
releasePeriod: ${VALID_ERAS.join(', ')}
intensity: ${VALID_INTENSITIES.join(', ')}
watchEffort: ${VALID_WATCH_EFFORTS.join(', ')}

EXAMPLES:
Query: "I'm tired, want an action movie, and I like The Godfather"
Output: {"mediaType":"movie","mood":["tired","low_effort"],"genres":["Action"],"likedTitles":["The Godfather"],"dislikedTitles":[],"mustInclude":[],"excludeGenres":[],"excludeContent":[],"language":null,"region":null,"maxRuntimeMinutes":null,"releasePeriod":null,"intensity":null,"watchEffort":"low","clarificationNeeded":false,"clarificationQuestion":null}

Query: "something like Breaking Bad but less violent"
Output: {"mediaType":"tv","mood":[],"genres":["Crime","Drama","Thriller"],"likedTitles":["Breaking Bad"],"dislikedTitles":[],"mustInclude":[],"excludeGenres":[],"excludeContent":["violence"],"language":null,"region":null,"maxRuntimeMinutes":null,"releasePeriod":null,"intensity":"low","watchEffort":null,"clarificationNeeded":false,"clarificationQuestion":null}

Query: "tired but want intense action"
Output: {"mediaType":"movie","mood":["tired","low_effort"],"genres":["Action"],"likedTitles":[],"dislikedTitles":[],"mustInclude":[],"excludeGenres":[],"excludeContent":[],"language":null,"region":null,"maxRuntimeMinutes":null,"releasePeriod":null,"intensity":"high","watchEffort":"low","clarificationNeeded":true,"clarificationQuestion":"When you say tired, do you want easy-to-follow action or something intense?"}`;

/**
 * Parse a natural-language query using Gemini (if API key available).
 * Returns null on any failure so caller can fall back to deterministic parser.
 */
async function parseWithLLM(query: string): Promise<ParsedPreferences | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'MovieNightPicker/1.0' } },
    });

    const response = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: query,
        config: {
          temperature: 0.1,
          systemInstruction: PARSE_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: PARSE_SCHEMA,
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('LLM timeout')), 3000)),
    ]);

    const text = response.text?.trim();
    if (!text) return null;

    const parsed = JSON.parse(text);
    // Add original query for debugging
    parsed.originalQuery = query.slice(0, 500);
    // likedTitles/dislikedTitles are free-text strings; resolution happens later
    return validatePreferences(parsed);
  } catch {
    return null;
  }
}

/**
 * Deterministic fallback parser using keyword dictionaries and the existing noteParser.
 * This extends the existing parseNote() with query-level understanding.
 */
function parseDeterministic(query: string): ParsedPreferences {
  const note = parseNote(query);
  const lower = query.toLowerCase();

  // Detect media type
  const mediaType: 'movie' | 'tv' = /\b(tv|show|series|episode|season)\b/.test(lower) ? 'tv' : 'movie';

  // Map note moods to internal mood labels
  const moodMap: Record<string, MoodLabel[]> = {
    Happy: ['happy', 'feel_good'],
    Relaxed: ['relaxed', 'easy_watch'],
    Tired: ['tired', 'low_effort', 'easy_watch'],
    Stressed: ['stressed'],
    Romantic: ['romantic'],
    Adventurous: ['adventurous', 'adrenaline'],
    Curious: ['curious'],
    Sad: ['sad', 'comforting'],
  };
  const moods: MoodLabel[] = [];
  for (const m of note.moods) {
    const mapped = moodMap[m];
    if (mapped) moods.push(...mapped);
  }

  // Additional mood detection from keywords
  if (/\b(tired|exhausted|low energy|brain.?dead|worn out)\b/.test(lower)) {
    moods.push('tired', 'low_effort');
  }
  if (/\b(intense|adrenaline|edge.of.seat|heart.?pounding|gripping)\b/.test(lower)) {
    moods.push('intense', 'adrenaline');
  }
  if (/\b(comforting|feel.?good|uplifting|heartwarming|cozy)\b/.test(lower)) {
    moods.push('comforting', 'feel_good');
  }
  if (/\b(easy.watch|low.effort|don.t want to think|mindless|simple)\b/.test(lower)) {
    moods.push('easy_watch', 'low_effort');
  }

  // Map note genres to internal genres
  const genres: GenreLabel[] = note.genres.filter((g): g is GenreLabel => VALID_GENRES.includes(g as GenreLabel));

  // Additional genre detection
  const genreKeywords: [RegExp, GenreLabel][] = [
    [/\baction\b|\baction.packed\b/, 'Action'],
    [/\badventure\b/, 'Adventure'],
    [/\banimation\b|\banime\b|\bpixar\b/, 'Animation'],
    [/\bcomedy\b|\bfunny\b|\bhilarious\b/, 'Comedy'],
    [/\bcrime\b|\bgangster\b|\bheist\b/, 'Crime'],
    [/\bdocumentary\b/, 'Documentary'],
    [/\bdrama\b/, 'Drama'],
    [/\bfamily\b|\bkids\b/, 'Family'],
    [/\bfantasy\b|\bmagic\b/, 'Fantasy'],
    [/\bhorror\b|\bscary\b/, 'Horror'],
    [/\bmystery\b|\bdetective\b|\bwhodunit\b/, 'Mystery'],
    [/\bromance\b|\brom.?com\b|\blove.story\b/, 'Romance'],
    [/\bsci.?fi\b|\bspace\b|\bcyberpunk\b/, 'Sci-Fi'],
    [/\bthriller\b|\bsuspense\b/, 'Thriller'],
    [/\bwestern\b/, 'Western'],
    [/\bwar\b/, 'War'],
    [/\bmusical\b/, 'Music'],
    [/\bhistorical\b|\bperiod\b/, 'History'],
  ];
  for (const [re, genre] of genreKeywords) {
    if (re.test(lower) && !genres.includes(genre)) genres.push(genre);
  }

  // Liked/disliked titles from note parser (already extracted)
  const likedTitles = note.lovedTitles.map(t => ({ title: t, year: null as number | null }));
  const dislikedTitles = note.hatedTitles.map(t => ({ title: t, year: null as number | null }));

  // Also check for "like X", "similar to X" patterns for liked titles
  const likePatterns = [
    /\blike\s+([A-Z][A-Za-z0-9'&:!\-]*(?:\s+[A-Za-z0-9'&:!\-]*)*)/g,
    /\bsimilar to\s+([A-Z][A-Za-z0-9'&:!\-]*(?:\s+[A-Za-z0-9'&:!\-]*)*)/g,
    /\bin the vein of\s+([A-Z][A-Za-z0-9'&:!\-]*(?:\s+[A-Za-z0-9'&:!\-]*)*)/g,
  ];
  for (const pattern of likePatterns) {
    let match;
    while ((match = pattern.exec(query)) !== null) {
      const title = match[1].trim();
      // Split on " and " to handle multiple titles like "The Godfather and Goodfellas"
      const parts = title.split(/\s+and\s+/i);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length >= 3 && !['The', 'And', 'With', 'Like', 'Similar', 'Vein'].includes(trimmed)) {
          likedTitles.push({ title: trimmed, year: null });
          // Infer genres from known popular titles
          inferGenresFromTitle(trimmed, genres);
        }
      }
    }
  }

  // Also infer genres from noteParser's lovedTitles and referenceTitles
  for (const t of note.lovedTitles) {
    inferGenresFromTitle(t, genres);
  }
  for (const t of note.referenceTitles) {
    inferGenresFromTitle(t, genres);
  }

  // Exclude genres from note
  const excludeGenres: GenreLabel[] = note.excludeGenres.filter((g): g is GenreLabel => VALID_GENRES.includes(g as GenreLabel));

  // Exclude content (unverifiable)
  const excludeContent = [...note.unverifiable];

  // Language
  let language: LanguageLabel | null = null;
  if (note.languageHints.length > 0) {
    const lang = note.languageHints[0];
    if (VALID_LANGUAGES.includes(lang as LanguageLabel)) language = lang as LanguageLabel;
  }

  // Runtime
  let maxRuntimeMinutes: number | null = null;
  if (note.runtimeHint === 'short') maxRuntimeMinutes = 90;
  else if (note.runtimeHint === 'long') maxRuntimeMinutes = 180;
  // Also check for explicit minute mentions
  const minuteMatch = lower.match(/(?:under|less than|max|maximum)\s*(\d+)\s*min/);
  if (minuteMatch) maxRuntimeMinutes = parseInt(minuteMatch[1], 10);

  // Release period
  let releasePeriod: EraLabel | null = null;
  if (note.eraHint === 'recent') releasePeriod = 'recent';
  else if (note.eraHint === 'classics') releasePeriod = 'classic';
  if (/\b(80s|1980s)\b/.test(lower)) releasePeriod = '80s';
  else if (/\b(90s|1990s)\b/.test(lower)) releasePeriod = '90s';
  else if (/\b(2000s|2010s)\b/.test(lower)) releasePeriod = '2010s';
  else if (/\b(new|latest|recent)\b/.test(lower) && !releasePeriod) releasePeriod = 'new';
  else if (/\b(classic|old|golden age|vintage)\b/.test(lower) && !releasePeriod) releasePeriod = 'classic';

  // Intensity
  let intensity: IntensityLevel | null = null;
  if (/\b(no violence|non.violent|peaceful|gentle)\b/.test(lower)) intensity = 'none';
  else if (/\b(mild|light|tame|restrained)\b/.test(lower)) intensity = 'low';
  else if (/\b(moderate|some violence)\b/.test(lower)) intensity = 'medium';
  else if (/\b(intense|graphic|brutal|gory|extreme|any violence)\b/.test(lower)) intensity = 'high';
  // From note parser's intensity preference
  if (note.comparativePreferences.some(c => c.attribute === 'intensity' || c.attribute === 'violence')) {
    const pref = note.comparativePreferences.find(c => c.attribute === 'intensity' || c.attribute === 'violence');
    if (pref?.direction === 'less') intensity = 'low';
    else if (pref?.direction === 'more') intensity = 'high';
  }

  // Watch effort
  let watchEffort: WatchEffortLevel | null = null;
  if (/\b(easy.watch|low.effort|don.t want to think|mindless|simple|light)\b/.test(lower)) watchEffort = 'low';
  else if (/\b(complex|demanding|heavy|deep|thought.?provoking)\b/.test(lower)) watchEffort = 'high';

  // Clarification detection
  let clarificationNeeded = false;
  let clarificationQuestion: string | null = null;
  const hasTired = moods.some(m => ['tired', 'low_effort', 'easy_watch'].includes(m));
  const hasIntense = moods.some(m => ['intense', 'adrenaline', 'edge_of_seat'].includes(m)) || intensity === 'high';
  if (hasTired && hasIntense) {
    clarificationNeeded = true;
    clarificationQuestion = "When you say tired, do you want easy-to-follow action or something intense?";
  }
  const hasComforting = moods.some(m => ['comforting', 'feel_good'].includes(m));
  const hasHorror = genres.includes('Horror') || excludeGenres.includes('Horror');
  if (hasComforting && hasHorror) {
    clarificationNeeded = true;
    clarificationQuestion = "You mentioned comforting but also horror — which direction should I lean?";
  }

  // Build raw object for validation
  const raw = {
    mediaType,
    mood: [...new Set(moods)],
    genres: [...new Set(genres)],
    likedTitles: likedTitles.map(t => ({ title: t.title })),
    dislikedTitles: dislikedTitles.map(t => ({ title: t.title })),
    mustInclude: [],
    excludeGenres,
    excludeContent: [...new Set(excludeContent)],
    language,
    region: null,
    maxRuntimeMinutes,
    releasePeriod,
    intensity,
    watchEffort,
    clarificationNeeded,
    clarificationQuestion,
    originalQuery: query.slice(0, 500),
  };

  return validatePreferences(raw);
}

/**
 * Main entry point: parse a user query into structured preferences.
 * Tries LLM first (if configured), falls back to deterministic parser.
 * Also accepts optional structured inputs (from UI quiz) that take precedence.
 */
export async function parseUserQuery(
  text: string,
  structuredInputs?: ParsedPreferences['structuredInputs']
): Promise<ParsedPreferences> {
  // Try LLM first
  const llmResult = await parseWithLLM(text);
  let parsed = llmResult || parseDeterministic(text);

  // Merge structured inputs (quiz answers) - they take precedence
  if (structuredInputs) {
    parsed = {
      ...parsed,
      ...structuredInputs,
      // Arrays: merge unique
      mood: structuredInputs.mood?.length ? structuredInputs.mood : parsed.mood,
      genres: structuredInputs.genres?.length ? structuredInputs.genres : parsed.genres,
      excludeGenres: structuredInputs.excludeGenres?.length
        ? [...new Set([...parsed.excludeGenres, ...structuredInputs.excludeGenres])]
        : parsed.excludeGenres,
    };
    parsed.structuredInputs = structuredInputs;
  }

  return parsed;
}

/**
 * Infer genres from known popular titles (fallback when TMDB resolution not available).
 * This is a minimal mapping for common reference titles.
 */
function inferGenresFromTitle(title: string, genres: GenreLabel[]): void {
  const knownTitles: Record<string, GenreLabel[]> = {
    'breaking bad': ['Crime', 'Drama', 'Thriller'],
    'breakingbad': ['Crime', 'Drama', 'Thriller'],
    'the wire': ['Crime', 'Drama'],
    'thewire': ['Crime', 'Drama'],
    'the sopranos': ['Crime', 'Drama'],
    'thesopranos': ['Crime', 'Drama'],
    'game of thrones': ['Fantasy', 'Drama', 'Adventure'],
    'gameofthrones': ['Fantasy', 'Drama', 'Adventure'],
    'stranger things': ['Sci-Fi', 'Horror', 'Mystery', 'Drama'],
    'strangerthings': ['Sci-Fi', 'Horror', 'Mystery', 'Drama'],
    'the crown': ['Drama', 'History'],
    'thecrown': ['Drama', 'History'],
    'cherkson': ['Crime', 'Drama', 'Mystery'],
    'better call saul': ['Crime', 'Drama'],
    'bettercallsaul': ['Crime', 'Drama'],
    'ozark': ['Crime', 'Drama', 'Thriller'],
    'narcos': ['Crime', 'Drama', 'History'],
    'mindhunter': ['Crime', 'Drama', 'Mystery', 'Thriller'],
    'true detective': ['Crime', 'Drama', 'Mystery', 'Thriller'],
    'truedetective': ['Crime', 'Drama', 'Mystery', 'Thriller'],
    'fargo': ['Crime', 'Drama', 'Thriller'],
    'the godfather': ['Crime', 'Drama'],
    'thegodfather': ['Crime', 'Drama'],
    'goodfellas': ['Crime', 'Drama'],
    'casino': ['Crime', 'Drama'],
    'pulp fiction': ['Crime', 'Drama'],
    'pulpfiction': ['Crime', 'Drama'],
    'the dark knight': ['Action', 'Crime', 'Drama', 'Thriller'],
    'thedarkknight': ['Action', 'Crime', 'Drama', 'Thriller'],
    'inception': ['Action', 'Sci-Fi', 'Thriller'],
    'interstellar': ['Adventure', 'Drama', 'Sci-Fi'],
    'parasite': ['Comedy', 'Drama', 'Thriller'],
    'the shawshank redemption': ['Drama'],
    'theshawshankredemption': ['Drama'],
    'fight club': ['Drama'],
    'fightclub': ['Drama'],
    'forrest gump': ['Drama', 'Romance'],
    'forrestgump': ['Drama', 'Romance'],
    'the matrix': ['Action', 'Sci-Fi'],
    'thematrix': ['Action', 'Sci-Fi'],
    'lord of the rings': ['Adventure', 'Fantasy', 'Drama'],
    'lordoftherings': ['Adventure', 'Fantasy', 'Drama'],
    'harry potter': ['Fantasy', 'Adventure', 'Family'],
    'harrypotter': ['Fantasy', 'Adventure', 'Family'],
    'star wars': ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'],
    'starwars': ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'],
    'marvel': ['Action', 'Adventure', 'Sci-Fi'],
    'avengers': ['Action', 'Adventure', 'Sci-Fi'],
  };

  const normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [known, inferredGenres] of Object.entries(knownTitles)) {
    if (normTitle.includes(known) || known.includes(normTitle)) {
      for (const g of inferredGenres) {
        if (!genres.includes(g)) genres.push(g);
      }
      break;
    }
  }
}
export async function resolveTitle(
  title: string,
  mediaType: 'movie' | 'tv' = 'movie',
  tmdbApiKey: string
): Promise<ResolvedTitle | null> {
  if (!tmdbApiKey || !title.trim()) return null;

  try {
    const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${tmdbApiKey}&query=${encodeURIComponent(title)}&include_adult=false`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'MovieNightPicker/1.0' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const results = (data.results || []).filter((r: any) =>
      r.poster_path && (r.release_date || r.first_air_date)
    );

    if (results.length === 0) return null;

    // Score matches: exact title match > year proximity > popularity
    const normQuery = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const scored = results.map((r: any) => {
      const normTitle = (r.title || r.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const year = parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10);
      let score = 0;
      if (normTitle === normQuery) score += 100;
      else if (normTitle.includes(normQuery) || normQuery.includes(normTitle)) score += 50;
      if (!isNaN(year)) score += Math.max(0, 20 - Math.abs(year - new Date().getFullYear()));
      score += Math.min(r.popularity || 0, 50);
      return { ...r, _score: score, _year: year };
    });

    scored.sort((a: any, b: any) => b._score - a._score);
    const best = scored[0];

    // Check for ambiguity: if 2nd result is close in score, return alternatives
    const alternatives: ResolvedTitle[] = [];
    if (scored.length > 1 && scored[1]._score > best._score * 0.7) {
      for (const alt of scored.slice(1, 3)) {
        alternatives.push({
          tmdbId: alt.id,
          mediaType,
          title: alt.title || alt.name,
          year: alt._year,
          imdbId: undefined, // Would need separate call
          confidence: 'low',
        });
      }
    }

    return {
      tmdbId: best.id,
      mediaType,
      title: best.title || best.name,
      year: best._year,
      imdbId: undefined,
      confidence: alternatives.length > 0 ? 'medium' : 'high',
      alternativeMatches: alternatives.length > 0 ? alternatives : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve multiple titles (liked + disliked) in parallel.
 */
export async function resolveTitles(
  titles: string[],
  mediaType: 'movie' | 'tv',
  tmdbApiKey: string
): Promise<ResolvedTitle[]> {
  const results = await Promise.all(
    titles.map(t => resolveTitle(t, mediaType, tmdbApiKey))
  );
  return results.filter((r): r is ResolvedTitle => r !== null);
}