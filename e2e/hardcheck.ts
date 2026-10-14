/** E10 hard-constraint checker: fails on any violation in an API response. */
export interface CheckInput {
  movies: any[];
  notices: string[];
}

const RUNTIME_CAPS: Record<string, number> = {
  'Under 90 min': 90,
  'Under 2 hours': 120,
  'Under 2.5 hours': 150,
  'Any length': Infinity,
};

const LANG_CODES: Record<string, string> = {
  English: 'en', Hindi: 'hi', Tamil: 'ta', Telugu: 'te',
  Korean: 'ko', Japanese: 'ja', Spanish: 'es', French: 'fr',
};

const FAMILY_CERTS = new Set(['G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG', 'U', 'U/A 7+']);
const MATURE_CERTS = new Set(['R', 'NC-17', 'X', 'TV-MA', 'A']);

export function checkHardConstraints(
  scenario: string,
  params: any,
  body: CheckInput,
): string[] {
  const violations: string[] = [];
  const cap = RUNTIME_CAPS[params.maxRuntime] ?? Infinity;
  const langCodes = (params.languages as string[])
    .filter((l) => l !== 'Any')
    .map((l) => LANG_CODES[l])
    .filter(Boolean);
  const seenIds = new Set<number>();
  const seenTitleYear = new Set<string>();
  for (const m of body.movies) {
    const tag = `${scenario} :: ${m.title} (${m.year})`;
    // H1 runtime
    if (Number.isFinite(cap)) {
      if (!(typeof m.runtime === 'number' && m.runtime > 0 && m.runtime <= cap)) {
        violations.push(`${tag}: H1 runtime ${m.runtime}m vs cap ${cap}m`);
      }
    }
    // H2 language
    if (langCodes.length > 0 && m.language && !langCodes.includes(m.language)) {
      violations.push(`${tag}: H2 language ${m.language} not in [${langCodes}]`);
    }
    // H4 rating floor
    if (params.preferences?.highlyRated && typeof m.rating === 'number' && m.rating < 7) {
      violations.push(`${tag}: H4 rating ${m.rating} < 7 with Highly rated ON`);
    }
    // H5 years
    const yr = new Date().getFullYear();
    if (params.preferences?.recent && !(m.year >= yr - 5)) {
      violations.push(`${tag}: H5 recent ${m.year} < ${yr - 5}`);
    }
    if (params.preferences?.classics && !(m.year < 2000)) {
      violations.push(`${tag}: H5 classics ${m.year} >= 2000`);
    }
    // H6 maturity / family
    const cert = String(m.certificate || '').trim();
    if (params.audience === 'Family with kids') {
      if (cert && !FAMILY_CERTS.has(cert.toUpperCase())) {
        violations.push(`${tag}: H6 family cert ${cert}`);
      }
    } else if (!params.preferences?.mature) {
      if (MATURE_CERTS.has(cert.toUpperCase())) {
        violations.push(`${tag}: H6 mature cert ${cert} with mature OFF`);
      }
    }
    // H7 dupes
    if (seenIds.has(m.id)) violations.push(`${tag}: H7 duplicate id ${m.id}`);
    seenIds.add(m.id);
    const ty = `${String(m.title).toLowerCase()}::${m.year}`;
    if (seenTitleYear.has(ty)) violations.push(`${tag}: H7 duplicate title+year`);
    seenTitleYear.add(ty);
  }
  return violations;
}
