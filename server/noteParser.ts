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
  /** @deprecated use lovedTitles; kept for compatibility. */
  mentionedTitles: string[];
  /** Language names from the quiz vocabulary (e.g. "Korean"). */
  languageHints: string[];
  runtimeHint?: 'short' | 'long';
  eraHint?: 'recent' | 'classics';
  wantsHighlyRated?: boolean;
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
  [/\bmystery\b|\bdetectiv|\bwhodunit\b|\bnoir\b/, 'Mystery'],
  [/\bromance\b|\brom-com\b|\bromcom\b|\blove stor/, 'Romance'],
  [/\bsci-?fi\b|\bspace\b|\bcyberpunk\b|\bdystopi/, 'Sci-Fi'],
  [/\bthriller\b|\bspy\b|\bespionage\b/, 'Thriller'],
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
];

const NEGATION_WORDS =
  'no|not|without|avoid|nothing|hate|dislike|skip|pass on|exclude|excluding|minus|except|other than|anything but|no more|free of|light on|less';

/**
 * Fix 2: scope-aware negation. Matches "not a horror movie" and
 * "no supernatural horror" (negation + optional article + up to two
 * intervening adjectives), not just immediately-adjacent "no X".
 */
function hasNegationScope(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 48), index);
  return new RegExp(
    `\\b(?:${NEGATION_WORDS})\\b(?:\\s+(?:a|an|the))?(?:\\s+[a-z]+){0,2}\\s*$`
  ).test(before);
}

/**
 * Contrastive "not only X but Y" must NEVER exclude X
 * ("not only funny but emotional" loves comedy, it doesn't ban it).
 * Returns spans [start, end) inside which genre hits stay positive.
 */
function contrastiveSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const re = /\bnot\s+(?:only|just|merely)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push([m.index, m.index + m[0].length + 24]);
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
  };
  if (!rawNote || typeof rawNote !== 'string') return signals;
  const text = ` ${rawNote.toLowerCase()} `;
  const guarded = contrastiveSpans(text);

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

  if (/\bshort\b|\bquick\b|\bunder 90\b|\bbrief\b|\bsnappy\b/.test(text)) signals.runtimeHint = 'short';
  else if (/\blong\b|\bepic\b|\bextended\b/.test(text)) signals.runtimeHint = 'long';

  if (/\brecent\b|\bnew\b|\b2020s\b|\blast five years\b|\bmodern\b/.test(text)) signals.eraHint = 'recent';
  else if (/\bclassic\b|\bold\b|\b90s\b|\b80s\b|\b70s\b|\bbefore 2000\b|\bgolden age\b|\bvintage\b/.test(text))
    signals.eraHint = 'classics';

  if (/\bacclaimed\b|\bmasterpiece\b|\boscar\b|\bhighly rated\b|\bbest\b|\bmust-?watch\b/.test(text)) {
    signals.wantsHighlyRated = true;
  }

  const LANGUAGE_HINTS: [RegExp, string][] = [
    [/\bkorean\b|\bk-?drama\b/, 'Korean'],
    [/\bhindi\b|\bbollywood\b/, 'Hindi'],
    [/\btamil\b|\bkollywood\b/, 'Tamil'],
    [/\btelugu\b|\btollywood\b/, 'Telugu'],
    [/\bjapanese\b|\banime\b/, 'Japanese'],
    [/\bfrench\b/, 'French'],
    [/\bspanish\b/, 'Spanish'],
    [/\benglish\b/, 'English'],
  ];
  for (const [re, lang] of LANGUAGE_HINTS) {
    if (re.test(text)) signals.languageHints.push(lang);
  }
  signals.languageHints = unique(signals.languageHints);

  signals.genres = unique(signals.genres);
  // Fix 2: explicit exclusions always win over positive mentions.
  signals.excludeGenres = unique(signals.excludeGenres);
  signals.genres = signals.genres.filter((g) => !signals.excludeGenres.includes(g));
  signals.unverifiable = unique(signals.unverifiable);
  signals.moods = unique(signals.moods);
  signals.lovedTitles = unique(signals.lovedTitles);
  signals.hatedTitles = unique(signals.hatedTitles);
  signals.mentionedTitles = unique(signals.lovedTitles);
  return signals;
}
