/**
 * Rule-based natural-language understanding for the optional free-text note.
 *
 * Deterministic and fully testable: converts a sentence like
 * "Loved Knives Out, no scary jump scares, something short please"
 * into structured signals the retrieval/ranking pipeline can enforce.
 * An LLM is deliberately NOT used here: without a configured key it
 * cannot run, and keyword rules cover the quiz-adjacent vocabulary.
 */

export interface NoteSignals {
  genres: string[];
  excludeGenres: string[];
  /** Descriptor phrases we cannot verify from metadata (e.g. "gore"). */
  unverifiable: string[];
  moods: string[];
  /** Normalized titles the user loves (rewatch/similarity signal). */
  lovedTitles: string[];
  /** Normalized titles the user dislikes (hard exclusion signal). */
  hatedTitles: string[];
  /** Reference titles for similarity matching ("like Interstellar"). */
  referenceTitles: string[];
  /** Reference titles exactly as typed (for user-facing disclosures). */
  referenceTitleNames: string[];
  /** @deprecated use lovedTitles; kept for compatibility. */
  mentionedTitles: string[];
  /** People to exclude (exact-ish name match against cast/director). */
  excludedPeople: string[];
  /** People the user likes (disclosed; cast ranking is unsupported). */
  likedPeople: string[];
  /** Language names from the quiz vocabulary (e.g. "Korean"). */
  languageHints: string[];
  /** User asks for episodic content ("web series", "TV show", "miniseries", "K-drama"). */
  wantsSeries?: boolean;
  /** Kid/family-safe mode ("movie for my 6 year old", "kids", "grandparents"). */
  audienceSafe?: boolean;
  /** Sub-genre words we recognize but cannot filter on (e.g. "superhero"). */
  unsupportedGenres: string[];
  runtimeHint?: 'short' | 'long';
  /** Explicit minute bounds ("under 2 hours", "over 150 minutes", "lambi"). */
  runtimeMinMinutes?: number;
  runtimeMaxMinutes?: number;
  /** Explicit year bounds ("after 2015", "before 1990", "in 2019"). */
  yearMin?: number;
  yearMax?: number;
  /** Set when min and max contradict ("under 60 but over 180 minutes"). */
  contradiction?: string;
  eraHint?: 'recent' | 'classics';
  wantsHighlyRated?: boolean;
  /** Plot/theme keywords extracted from query. */
  themeKeywords: string[];
  /** Comparative preferences ("less dark", "more funny"). */
  comparativePreferences: Array<{ direction: 'less' | 'more'; attribute: string; reference?: string }>;
}

const GENRE_KEYWORDS: [RegExp, string][] = [
  [/\baction\b|\baction-packed\b|\bmartial arts\b/, 'Action'],
  [/\badventure\b|\bquest\b|\bexplor/, 'Adventure'],
  [/\banimat|\bcartoon\b|\banime\b|\bpixar\b|\bghibli\b/, 'Animation'],
  [/\bcomed|\bfunny\b|\bhilarious\b|\blaugh/, 'Comedy'],
  [/\bcrime\b|\bgangster\b|\bheist\b|\bmafia\b/, 'Crime'],
  [/\bdocumentary\b|\bdocuseries\b|\bdoc\b/, 'Documentary'],
  [/\bdrama\b|\bmelodrama\b/, 'Drama'],
  [/\bfamily\b|\bkids\b|\bchildren\b/, 'Family'],
  [/\bfantasy\b|\bmagic\b/, 'Fantasy'],
    [/\bhorror\b|\bsuspenseless\b/, 'Horror'], // "horror" handled; scary/gore map below
  // Romanized Hindi/Hinglish genre words.
  [/\bmazakiya\b|\bhasya\b/, 'Comedy'],
  [/\bdaravni\b|\bdarawani\b/, 'Horror'],
  [/\bromantik\b|\bpyaar\b/, 'Romance'],
  [/\bmystery\b|\bdetectiv|\bwhodunit\b|\bnoir\b/, 'Mystery'],
  [/\bromance\b|\brom-com\b|\bromcom\b|\brom com\b|\blove stor|\bromantic\b/, 'Romance'],
  [/\bsci-?fi\b|\bsc-?fi\b|\bscience fiction\b|\bspace\b|\bcyberpunk\b|\bdystopi/, 'Sci-Fi'],
  [/\bthriller\b|\bspy\b|\bespionage\b/, 'Thriller'],
  // Catalog-backed genres that were missing (covered by the SQL filter +
  // an honest coverage notice when the catalog has no/wanting titles).
  [/\bwar\b/, 'War'],
  [/\bmusical\b|\bmusic\b/, 'Music'],
  [/\bwestern\b|\bcowboy\b/, 'Western'],
  [/\bhistor(y|ical)\b|\bperiod (piece|drama)\b/, 'History'],
  [/\bbiograph|\bbiopic\b|\btrue stor|\bbased on (a |the )?true\b/, 'Biography'],
  [/\bsports?\b/, 'Sports'],
  // Devanagari script genres (Hindi-script queries). Note: \b is ASCII-only
  // in JS, so these are substring matches on distinctive words.
  [/कॉमेडी|हास्य/, 'Comedy'],
  [/रोमांस|रोमांटिक|प्रेम/, 'Romance'],
  [/हॉरर|डरावनी/, 'Horror'],
  [/एक्शन/, 'Action'],
  [/थ्रिलर/, 'Thriller'],
  [/ड्रामा/, 'Drama'],
  [/साइंस फिक्शन|विज्ञान फंतासी/, 'Sci-Fi'],
  [/रहस्य/, 'Mystery'],
];

/**
 * Sub-genre words people ask for that NO catalog tag can verify ("superhero"
 * is not a TMDB genre). They become an honest disclosure, never a genre
 * request and never a silent fallback. Excluded mentions ("not a superhero
 * movie") must NOT re-introduce Action or trigger the disclosure.
 */
const UNSUPPORTED_GENRE_WORDS: [RegExp, string][] = [
  [/\bsuperhero(?:es)?\b/, 'Superhero'],
  [/\btrue stor(?:y|ies)\b|\bbased on (a |the )?true story\b/, 'True Story'],
];

const THEME_KEYWORDS: [RegExp, string][] = [
  [/\bspace\b|\bspace travel\b|\binterstellar\b|\bgalaxy\b|\bcosmic\b/, 'space'],
  [/\btime travel\b|\btemporal\b|\btime loop\b|\btime machine\b/, 'time travel'],
  [/\bcoming of age\b|\bgrowing up\b|\bteen\b|\badolescen/, 'coming of age'],
  [/\bheist\b|\bheist movie\b|\bcapers?\b/, 'heist'],
  [/\bsuperhero\b|\bmarvel\b|\bdc comic\b|\bsuperhero movie\b/, 'superhero'],
  [/\bzombie\b|\bapocalyps\b|\bpost-apocalyptic\b/, 'zombie'],
  [/\bvampire\b|\bwerewolf\b|\bcreature feature\b/, 'vampire'],
  [/\bdetective\b|\bwhodunit\b|\bmystery\b|\bnoir\b/, 'detective'],
  [/\bwar\b|\bworld war\b|\bwwii\b|\bvietnam war\b/, 'war'],
  [/\bromance\b|\blove story\b|\bromantic\b/, 'romance'],
  [/\bfriendship\b|\bbuddy\b|\bplatonic\b/, 'friendship'],
  [/\bfamily\b|\bparent\b|\bchild\b|\bkid\b/, 'family'],
  [/\bsurvival\b|\bstranded\b|\bwilderness\b|\bdesert island\b/, 'survival'],
  [/\bpsychological\b|\bmind bend\b|\btwist\b|\bunreliable narrator\b/, 'psychological'],
  [/\bmusical\b|\bmusic movie\b|\bsinging\b/, 'musical'],
  [/\bbiopic\b|\btrue story\b|\bbased on true\b/, 'biopic'],
  [/\bcourtroom\b|\blegal\b|\blawyer\b/, 'courtroom'],
  [/\bsports\b|\bathlet\b|\bfootball\b|\bbaseball\b|\bbasketball\b/, 'sports'],
  [/\bmartial arts\b|\bkung fu\b|\bkarate\b/, 'martial arts'],
  [/\banimation\b|\banime\b|\bpixar\b|\bdisney\b|\bghibli\b/, 'animation'],
  [/\bcomedy\b|\bfunny\b|\bhilarious\b/, 'comedy'],
  [/\bdrama\b|\bserious\b|\bheavy\b|\bemotional\b/, 'drama'],
  [/\bthriller\b|\bsuspense\b|\bedge of seat\b/, 'thriller'],
  [/\bhorror\b|\bscary\b|\bcreepy\b/, 'horror'],
  [/\baction\b|\baction-packed\b|\bhigh octane\b/, 'action'],
  [/\badventure\b|\bquest\b|\bjourney\b/, 'adventure'],
  [/\bcrime\b|\bgangster\b|\bmafia\b/, 'crime'],
  [/\bmystery\b|\bpuzzle\b|\benigma\b/, 'mystery'],
  [/\bsci.?fi\b|\bfuturistic\b|\bcyberpunk\b|\bdystopi\b/, 'sci-fi'],
  [/\btime travel\b|\btimetravel\b|\btemporal\b/, 'time travel'],
  [/\bfantasy\b|\bmagic\b|\bwizard\b|\bdragon\b/, 'fantasy'],
  [/\bhistorical\b|\bperiod piece\b|\b19\d\d\b|\b20\d\d\b/, 'historical'],
  [/\bwestern\b|\bcowboy\b/, 'western'],
];

const EXCLUSION_KEYWORDS: [RegExp, string][] = [
  [/\bscary\b|\bcreepy\b/, 'Horror'],
  [/\bmushy\b/, 'Romance'],
  [/\bkids\b|\bchildish\b/, 'Family'],
];

/**
 * Sub-genre texture words that name no verifiable genre. These must NEVER
 * become genre bans ("without gore" is not "without Horror"); they are
 * surfaced as honest limitations instead.
 */
const UNVERIFIABLE_HINTS: [RegExp, string][] = [
  [/\bgore\b|\bgory\b|\bbloody\b/, 'gore'],
  [/\bviolent\b|\bviolence\b/, 'violence'],
  [/\bjump scares?\b/, 'jump scares'],
  [/\bslow\b|\bboring\b|\bdull\b|\bpacing\b/, 'pacing'],
  [/\bsad\b|\bdepressing\b|\bcry\b|\btearjerker\b/, 'sad tone'],
  [/\bcartoonish\b/, 'cartoonish tone'],
  [/\btwist\b|\btwists\b|\bending\b/, 'plot twists'],
  [/\bfound[\s-]?footage\b/, 'found footage'],
  [/\btragic\b/, 'tragic tone'],
];

const MOOD_KEYWORDS: [RegExp, string][] = [
  [/\bhappy\b|\bcheerful\b|\bfeel-?good\b|\buplifting\b/, 'Happy'],
  [/\brelaxed\b|\bcozy\b|\bchill\b|\bmellow\b|\blaid-?back\b/, 'Relaxed'],
  [/\btired\b|\bexhausted\b|\blow energy\b|\bbrain-?dead\b/, 'Tired'],
  [/\bstress|\brought? day\b|\boverwhelmed\b|\banxious\b/, 'Stressed'],
  [/\bromantic\b|\bdate night\b|\bintimate\b/, 'Romantic'],
  [/\badventur|\bepic\b|\bthrill/, 'Adventurous'],
  [/\bcurious\b|\bmind-?bend|\bthought-?provoking\b|\bclever\b/, 'Curious'],
  [/\bsad\b|\bdown\b|\bblue\b|\bheartbreak\b/, 'Sad'],
  // Romanized Hindi/Hinglish mood words (real user queries mix these with English).
  [/\bkhush\b|\bmaza\b|\bmast\b/, 'Happy'],
  [/\bhalka\b|\baaraam\b/, 'Relaxed'],
  [/\bthaka\b|\bthakan\b/, 'Tired'],
  [/\btanav\b|\bpareshan\b/, 'Stressed'],
  [/\bpyaar\b|\bromantik\b|\bmohabbat\b/, 'Romantic'],
  [/\budaas\b|\bdukhi\b/, 'Sad'],
];

// Reference movie patterns: "like X", "similar to X", "in the vein of X", "reminiscent of X"
const REFERENCE_PATTERNS: RegExp[] = [
  /\blike\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g,
  /\bsimilar to\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g,
  /\bin the vein of\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g,
  /\breminiscent of\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g,
  /\bakin to\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g,
  /\bresembles\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g,
];

// Comparative patterns: "less dark than X", "more funny than X", "shorter than X"
const COMPARATIVE_PATTERNS: [RegExp, string][] = [
  [/\bless\s+(\w+)\s+than\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g, 'less'],
  [/\bmore\s+(\w+)\s+than\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g, 'more'],
  [/\bshorter than\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g, 'shorter'],
  [/\blonger than\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g, 'longer'],
  [/\bdarker than\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g, 'darker'],
  [/\blighter than\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g, 'lighter'],
  [/\bfunnier than\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g, 'funnier'],
  [/\bscarier than\s+([A-Z][A-Za-z0-9'&:!\\-]*(?:\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)/g, 'scarier'],
];

const NEGATION_WORDS =
  'no|not|without|avoid|nothing|hate|dislike|skip|pass on|exclude|excluding|minus|except|other than|anything but|no more|free of|light on|less|nahi|nahin|mat|don\'t|don’t';

/**
 * Fix 2: scope-aware negation. Matches "not a horror movie" and
 * "no supernatural horror" (negation + optional article + up to two
 * intervening adjectives), not just immediately-adjacent "no X".
 * Window expanded to 64 chars and relaxed trailing match for robustness.
 */
function hasNegationScope(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 64), index);
  if (
    new RegExp(
      `\\b(?:${NEGATION_WORDS})\\b(?:\\s+(?:a|an|the))?(?:\\s+[a-z]+){0,3}\\s*$`
    ).test(before)
  ) {
    return true;
  }
  // Hindi SOV order postposes negation ("daravni nahi" = no horror). Forward
  // scope applies ONLY to Hindi negations; English post-negation ("comedy,
  // not really") must never exclude.
  const after = text.slice(index, index + 40);
  return /^\s*[a-z]+\s+(?:[a-z]+\s+){0,2}\b(nahi|nahin|mat)\b/.test(after);
}

/**
 * Contrastive "not only X but Y" must NEVER exclude X
 * ("not only funny but emotional" loves comedy, it doesn't ban it).
 * Returns spans [start, end) inside which genre hits stay positive.
 * Span extends to end of clause after "but"/"however"/period.
 */
function contrastiveSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const re = /\bnot\s+(?:only|just|merely)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Find the "but" or "however" or sentence end after "not only"
    const after = text.slice(m.index + m[0].length);
    const butMatch = after.match(/\bbut\b/i);
    const howeverMatch = after.match(/\bhowever\b/i);
    const sentenceEnd = after.search(/[.!?]/);
    const butIndex = butMatch?.index ?? 100;
    let end = m.index + m[0].length + butIndex;
    const howeverIndex = howeverMatch?.index;
    if (howeverMatch && howeverIndex !== undefined && (!sentenceEnd || howeverIndex < sentenceEnd)) {
      end = m.index + m[0].length + howeverIndex;
    } else if (sentenceEnd >= 0) {
      end = m.index + m[0].length + sentenceEnd + 1;
    }
    spans.push([m.index, end]);
  }
  return spans;
}

function inSpans(spans: [number, number][], index: number): boolean {
  return spans.some(([s, e]) => index >= s && index < e);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function parseNote(rawNote: string): NoteSignals {
  const signals: NoteSignals = {
    genres: [], excludeGenres: [], unverifiable: [], moods: [],
    lovedTitles: [], hatedTitles: [], mentionedTitles: [], languageHints: [],
    excludedPeople: [], likedPeople: [], unsupportedGenres: [],
    referenceTitles: [],
    referenceTitleNames: [],
    themeKeywords: [],
    comparativePreferences: [],
  };
  if (!rawNote || typeof rawNote !== 'string') return signals;
  const text = ` ${rawNote.toLowerCase()} `;
  const guarded = contrastiveSpans(text);

  // Extract reference titles: "like X", "similar to X", etc.
  for (const pattern of REFERENCE_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, 'gi');
    while ((match = regex.exec(rawNote)) !== null) {
      const title = match[1].trim();
      if (title.length >= 3 && !['the', 'and', 'with', 'like', 'similar', 'vein', 'reminiscent', 'akin', 'resembles'].includes(title.toLowerCase())) {
        const norm = title.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (norm.length >= 3) {
          signals.referenceTitles.push(norm);
          signals.referenceTitleNames.push(title);
        }
      }
    }
  }

  // Extract theme keywords
  for (const [re, theme] of THEME_KEYWORDS) {
    if (re.test(text)) signals.themeKeywords.push(theme);
  }

  // Extract comparative preferences
  for (const [re, direction] of COMPARATIVE_PATTERNS) {
    let match;
    const regex = new RegExp(re.source, 'gi');
    while ((match = regex.exec(rawNote)) !== null) {
      const attribute = match[1] || '';
      const reference = match[2] || '';
      signals.comparativePreferences.push({
        direction: direction as 'less' | 'more',
        attribute: attribute.toLowerCase(),
        reference: reference ? reference.toLowerCase().replace(/[^a-z0-9]/g, '') : undefined,
      });
    }
  }

  // Every occurrence counts: "love horror, but no horror tonight" must
  // register both the positive AND the exclusion (exclusion wins).
  for (const [re, genre] of GENRE_KEYWORDS) {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
      const idx = m.index ?? 0;
      // Explicit exclusions override positive mentions (Fix 2).
      if (!inSpans(guarded, idx) && hasNegationScope(text, idx)) {
        signals.excludeGenres.push(genre);
      } else {
        signals.genres.push(genre);
      }
    }
  }
  for (const [re, label] of UNSUPPORTED_GENRE_WORDS) {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
      if (!inSpans(guarded, m.index ?? 0) && !hasNegationScope(text, m.index ?? 0)) {
        signals.unsupportedGenres.push(label);
      }
    }
  }
  for (const [re, genre] of EXCLUSION_KEYWORDS) {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
      if (hasNegationScope(text, m.index ?? 0)) {
        signals.excludeGenres.push(genre);
      }
    }
  }
  for (const [re, label] of UNVERIFIABLE_HINTS) {
    if (re.test(text)) signals.unverifiable.push(label);
  }

  for (const [re, mood] of MOOD_KEYWORDS) {
    if (re.test(text)) signals.moods.push(mood);
  }

  // Quoted titles: 'Knives Out', "Arrival" (negated quotes count as hated)
  const quoted = rawNote.match(/['"]([^'"]{2,60})['"]/g) || [];
  for (const q of quoted) {
    const at = rawNote.indexOf(q);
    const inner = q.slice(1, -1).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (inner.length >= 3 && !['the', 'and', 'with'].includes(inner)) {
      (hasNegationScope(` ${rawNote.toLowerCase()} `, at + 1)
        ? signals.hatedTitles
        : signals.lovedTitles
      ).push(inner);
    }
  }

  // "loved/liked X" vs "hated/dislike X" — verb case-insensitive, titles
  // must start capitalized (stops at lowercase words like "and"/"but").
  const TITLE_RUN = `([A-Za-z][A-Za-z0-9'&:!\\-]*(?:\\s+[A-Z][A-Za-z0-9'&:!\\-]*)*)`;
  const loved = rawNote.match(
    new RegExp(`\\b(?:[Ll]oved?|[Ll]iked?|[Ee]njoyed?|[Oo]bsessed with)\\s+${TITLE_RUN}`)
  );
  if (loved?.[1]) {
    const norm = loved[1].trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm.length >= 3 && !['the', 'and', 'with'].includes(norm)) {
      signals.lovedTitles.push(norm);
    }
  }
  const hated = rawNote.match(
    new RegExp(`\\b(?:[Hh]ated?|[Dd]islike[sd]?|[Cc]an't [Ss]tand|[Dd]espise[sd]?)\\s+${TITLE_RUN}`)
  );
  if (hated?.[1]) {
    const norm = hated[1].trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm.length >= 3 && !['the', 'and', 'with'].includes(norm)) {
      signals.hatedTitles.push(norm);
    }
  }
  signals.mentionedTitles = unique(signals.lovedTitles);

  // Fix 2b: person names. "Nothing with Tom Cruise" excludes; "movies
  // starring Tom Hanks" is a (disclosed) preference. Single names are
  // ignored — too noisy ("nothing with Tom" could be anyone).
  const NAME = `([A-Z][A-Za-z.'\\-]*(?:\\s+[A-Z][A-Za-z.'\\-]*)+)`;
  const castRe = new RegExp(`\\b(?:with|starring|featuring)\\s+${NAME}`, 'g');
  let cm: RegExpExecArray | null;
  while ((cm = castRe.exec(rawNote)) !== null) {
    const name = cm[1].replace(/[.]+$/, '');
    if (name.split(' ').length >= 2) {
      (hasNegationScope(text, cm.index)
        ? signals.excludedPeople
        : signals.likedPeople
      ).push(name);
    }
  }
  const dirRe = new RegExp(`\\b(?:directed by|a film by|from director)\\s+${NAME}`, 'g');
  let dm: RegExpExecArray | null;
  while ((dm = dirRe.exec(rawNote)) !== null) {
    const name = dm[1].replace(/[.]+$/, '');
    if (name.split(' ').length >= 2) {
      (hasNegationScope(text, dm.index)
        ? signals.excludedPeople
        : signals.likedPeople
      ).push(name);
    }
  }

  // Fix 2e: comparatives. Bare "shorter"/"longer" (e.g. "like X but
  // shorter") resolve to the short/long hints; the quiz cap still wins
  // and any conflict is disclosed downstream.
  if (/\bshort\b|\bshorter\b|\bquick\b|\bunder 90\b|\bbrief\b|\bsnappy\b|\bchhoti\b|\bchhota\b/.test(text)) signals.runtimeHint = 'short';
  else if (/\blong\b|\blonger\b|\bepic\b|\bextended\b|\blambi\b|\blamba\b/.test(text)) signals.runtimeHint = 'long';

  // Explicit minute bounds beat bare hints; "long" is a minimum, never a max.
  let rMinPhrase = '';
  let rMaxPhrase = '';
  {
    let rm: RegExpMatchArray | null;
    if ((rm = text.match(/\bunder\s+(\d+)\s*hours?\b/))) {
      signals.runtimeMaxMinutes = Number(rm[1]) * 60; rMaxPhrase = rm[0].trim();
    } else if ((rm = text.match(/\bunder\s+(\d+)\s*min(?:utes?)?\b/))) {
      signals.runtimeMaxMinutes = Number(rm[1]); rMaxPhrase = rm[0].trim();
    } else if ((rm = text.match(/(\d+)\s*ghante?\s*se\s*kam\b/))) {
      signals.runtimeMaxMinutes = Number(rm[1]) * 60; rMaxPhrase = rm[0].trim();
    }
    if ((rm = text.match(/\blonger\s+than\s+(\d+)\s*min(?:utes?)?\b/))) {
      signals.runtimeMinMinutes = Number(rm[1]); rMinPhrase = rm[0].trim();
    } else if ((rm = text.match(/\bover\s+(\d+)\s*hours?\b/))) {
      signals.runtimeMinMinutes = Number(rm[1]) * 60; rMinPhrase = rm[0].trim();
    } else if ((rm = text.match(/\bover\s+(\d+)\s*min(?:utes?)?\b/))) {
      signals.runtimeMinMinutes = Number(rm[1]); rMinPhrase = rm[0].trim();
    }
    // "between 100 and 120 minutes" sets both bounds at once.
    if ((rm = text.match(/\bbetween\s+(\d+)\s+and\s+(\d+)\s*min(?:utes?)?\b/))) {
      signals.runtimeMinMinutes = Number(rm[1]); rMinPhrase = rm[0].trim();
      if (signals.runtimeMaxMinutes === undefined) {
        signals.runtimeMaxMinutes = Number(rm[2]); rMaxPhrase = rm[0].trim();
      }
    }
    // "90 minute movie" / "2 hour movie" — the stated length is the MAX.
    if (signals.runtimeMaxMinutes === undefined) {
      if ((rm = text.match(/\b(\d{2,3})\s*min(?:ute)?s?\s+(?:movie|film|long)\b/))) {
        signals.runtimeMaxMinutes = Number(rm[1]); rMaxPhrase = rm[0].trim();
      } else if ((rm = text.match(/\b(\d+)\s*hours?\s+(?:movie|film|long)\b/))) {
        signals.runtimeMaxMinutes = Number(rm[1]) * 60; rMaxPhrase = rm[0].trim();
      }
    }
  }
  if (signals.runtimeHint === 'long' && signals.runtimeMinMinutes === undefined) {
    signals.runtimeMinMinutes = 150;
  }
  if (signals.runtimeMinMinutes !== undefined && signals.runtimeMaxMinutes !== undefined &&
    signals.runtimeMinMinutes > signals.runtimeMaxMinutes) {
    signals.contradiction =
      `No movie can be both ${rMaxPhrase || 'short'} and ${rMinPhrase || 'long'}`;
  }

  // Explicit year bounds.
  {
    let ym: RegExpMatchArray | null;
    if ((ym = text.match(/(\d{4})\s+or\s+later\b/))) {
      const y = Number(ym[1]);
      if (y >= 1900 && y <= 2100) signals.yearMin = y;
    }
    if ((ym = text.match(/\bafter\s+(19\d{2}|20\d{2})\b/))) signals.yearMin = Number(ym[1]) + 1;
    if ((ym = text.match(/\bbefore\s+(19\d{2}|20\d{2})\b/))) signals.yearMax = Number(ym[1]) - 1;
    if ((ym = text.match(/\bfrom\s+the\s+(\d{2})s\b/))) {
      signals.yearMin = 1900 + Number(ym[1]); signals.yearMax = 1900 + Number(ym[1]) + 9;
    } else if ((ym = text.match(/\bfrom\s+the\s+((?:19|20)\d{2})s\b/))) {
      const d = Math.floor(Number(ym[1]) / 10) * 10;
      signals.yearMin = d; signals.yearMax = d + 9;
    }
    if ((ym = text.match(/\bin\s+(19\d{2}|20\d{2})\b/))) {
      signals.yearMin = Number(ym[1]); signals.yearMax = Number(ym[1]);
    }
    // "movie of the 90s" / "of the 2020s" / "90s movie" — a strict decade.
    if ((ym = text.match(/\bof\s+the\s+((?:19|20)\d{2})s\b/)) || (ym = text.match(/\bof\s+the\s+(\d{2})s\b/))) {
      const d = ym[1].length === 2 ? 1900 + Number(ym[1]) : Math.floor(Number(ym[1]) / 10) * 10;
      signals.yearMin = d; signals.yearMax = d + 9;
    } else if ((ym = text.match(/\b((?:19|20)\d{2})s\s+(?:movie|film)s?\b/))) {
      const d = Math.floor(Number(ym[1]) / 10) * 10;
      signals.yearMin = d; signals.yearMax = d + 9;
    } else if ((ym = text.match(/\b(\d{2})s\s+(?:movie|film)s?\b/))) {
      signals.yearMin = 1900 + Number(ym[1]); signals.yearMax = 1900 + Number(ym[1]) + 9;
    }
    // Spelled-out decades ("nineties").
    if (signals.yearMin === undefined && (ym = text.match(/\b(nineties|eighties|seventies|sixties)\b/))) {
      const start: Record<string, number> = { nineties: 1990, eighties: 1980, seventies: 1970, sixties: 1960 };
      const d = start[ym[1]]; signals.yearMin = d; signals.yearMax = d + 9;
    }
    // "old black and white classic" — monochrome era, strictly before 1970.
    if (/\bblack[- ](?:and|&)[- ]white\b|\bb&w\b/.test(text)) signals.yearMax = 1969;
    // "newest releases of 2026" → that year or later (downstream: honest
    // notice when nothing recent enough exists).
    if ((ym = text.match(/\b(?:newest|latest)\b[\s\S]{0,40}?\b(19\d{2}|20\d{2})\b/))) {
      signals.yearMin = Number(ym[1]) - 1;
    } else if (/\b(?:newest|latest)\b/.test(text) && signals.yearMin === undefined) {
      signals.yearMin = new Date().getFullYear() - 1;
    }
  }

  // Kid/family-safe mode: explicit ages, "kids", "grandparents", Hinglish
  // "bachon ke liye". Negated kid words ("no kids movies tonight") do NOT
  // trigger it.
  {
    const KID_RE = /\b\d{1,2}\s*[- ]?\s*years?\s*[- ]?\s*old\b|\bkids\b|\bchildren\b|\btoddler|\bbach\w*\b|\bke liye\b|\bfor\s+(?:my\s+)?(?:son|daughter|kids?)\b|\bgrandparents?\b|\bteen sleepover\b|\bwhole family\b|\bfamily movie\b|\bfamily film\b/g;
    for (const m of text.matchAll(KID_RE)) {
      if (!hasNegationScope(text, m.index ?? 0)) { signals.audienceSafe = true; break; }
    }
  }
  // The user asks for episodic content: never serve movies as a silent match.
  if (/\bweb[\s-]?series\b|\btv[\s-]?shows?\b|\bmini-?series\b|\bseries\b|\bk-?drama\b|\bbinge-?worth/.test(text)) {
    signals.wantsSeries = true;
  }

  // "6 year old" / "my kid is 8 years old" must NOT read as "old classic".
  const eraText = text.replace(/\b\d{1,2}\s*[- ]?\s*years?\s*[- ]?\s*old\b/g, ' ');
  if (/\brecent\b|\bnew\b|\b2020s\b|\blast five years\b|\bmodern\b|\bnayi\b|\bnaya\b/.test(eraText)) signals.eraHint = 'recent';
  else if (/\bclassic\b|\bold\b|\b90s\b|\b80s\b|\b70s\b|\bbefore 2000\b|\bgolden age\b|\bvintage\b|\bpurani\b|\bpurana\b/.test(eraText))
    signals.eraHint = 'classics';

  if (/\bacclaimed\b|\bmasterpiece\b|\boscar\b|\bhighly rated\b|\bbest\b|\bmust-?watch\b/.test(text)) {
    signals.wantsHighlyRated = true;
  }

  const LANGUAGE_HINTS: [RegExp, string | string[]][] = [
    [/\bkorean\b|\bk-?drama\b/, 'Korean'],
    [/\bhindi\b/, 'Hindi'],
    [/\bbollywood\b/, 'Hindi'],
    [/\btamil\b/, 'Tamil'],
    [/\bkollywood\b/, 'Tamil'],
    [/\btelugu\b/, 'Telugu'],
    [/\btollywood\b/, 'Telugu'],
    [/\bmalayalam\b/, 'Malayalam'],
    [/\bmollywood\b/, 'Malayalam'],
    [/\bkannada\b/, 'Kannada'],
    [/\bsandalwood\b/, 'Kannada'],
    [/\bbengali\b/, 'Bengali'],
    [/\bmarathi\b/, 'Marathi'],
    [/\bpunjabi\b/, 'Punjabi'],
    [/\bgujarati\b/, 'Gujarati'],
    [/\burdu\b/, 'Urdu'],
    [/\bchinese\b|\bmandarin\b|\bcantonese\b/, 'Chinese'],
    [/\bgerman\b/, 'German'],
    [/\bitalian\b/, 'Italian'],
    [/\bturkish\b/, 'Turkish'],
    [/\bthai\b/, 'Thai'],
    [/\brussian\b/, 'Russian'],
    [/\bportuguese\b|\bbrazilian\b/, 'Portuguese'],
    [/\barabic\b/, 'Arabic'],
    [/\bindonesian\b/, 'Indonesian'],
    [/\bpersian\b|\bfarsi\b/, 'Persian'],
    [/\bpolish\b/, 'Polish'],
    [/\bdutch\b/, 'Dutch'],
    [/\bswedish\b/, 'Swedish'],
    [/\bjapanese\b|\banime\b/, 'Japanese'],
    [/\bfrench\b/, 'French'],
    [/\bspanish\b/, 'Spanish'],
    [/\benglish\b/, 'English'],
    // Industry umbrella: one ask for the four large southern industries.
    [/\bsouth indian\b/, ['Tamil', 'Telugu', 'Malayalam', 'Kannada']],
  ];
  for (const [re, lang] of LANGUAGE_HINTS) {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
      // "no Bollywood, only South Indian" — the negated industry word must
      // not enter the language filters at all.
      if (hasNegationScope(text, m.index ?? 0)) continue;
      signals.languageHints.push(...(Array.isArray(lang) ? lang : [lang]));
    }
  }
  signals.languageHints = unique(signals.languageHints);

  signals.genres = unique(signals.genres);
  // Fix 2: explicit exclusions always win over positive mentions.
  signals.excludeGenres = unique(signals.excludeGenres);
  signals.genres = signals.genres.filter((g) => !signals.excludeGenres.includes(g));
  signals.unverifiable = unique(signals.unverifiable);
  signals.unsupportedGenres = unique(signals.unsupportedGenres);
  signals.moods = unique(signals.moods);
  signals.lovedTitles = unique(signals.lovedTitles);
  signals.hatedTitles = unique(signals.hatedTitles);
  signals.mentionedTitles = unique(signals.lovedTitles);
  signals.referenceTitles = unique(signals.referenceTitles);
  signals.referenceTitleNames = unique(signals.referenceTitleNames);
  signals.themeKeywords = unique(signals.themeKeywords);
  signals.comparativePreferences = signals.comparativePreferences.filter((c, i, arr) => 
    arr.findIndex(x => x.attribute === c.attribute && x.direction === c.direction && x.reference === c.reference) === i
  );
  signals.excludedPeople = unique(signals.excludedPeople);
  signals.likedPeople = unique(signals.likedPeople).filter(
    (p) => !signals.excludedPeople.includes(p)
  );
  return signals;
}
