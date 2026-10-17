/**
 * One canonical spelling per genre at every boundary.
 *
 * TMDB-derived data stores "Science Fiction"; the quiz vocabulary is
 * "Sci-Fi". Stored rows may use either spelling, so SQL filters must match
 * both (expandGenres) while everything user-facing / ranked uses one
 * canonical spelling (canonicalGenres). Add future synonym groups here only.
 */

const EQUIVALENT_GROUPS: string[][] = [
  ['Sci-Fi', 'Science Fiction'],
];

const CANONICAL = new Map<string, string>();
// Lookup key: case- and separator-insensitive, so "Sci-Fi", "sci fi" and
// "SCI_FI" all land on the same canonical entry.
function lookupKey(name: string): string {
  return name.trim().toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
}
for (const group of EQUIVALENT_GROUPS) {
  for (const name of group) CANONICAL.set(lookupKey(name), group[0]);
}

/** Canonical spelling for display and ranking ("Science Fiction" -> "Sci-Fi"). */
export function canonicalGenre(genre: string): string {
  const trimmed = genre.trim();
  return CANONICAL.get(lookupKey(trimmed)) ?? trimmed;
}

/** Canonical, de-duplicated genre list for one movie. */
export function canonicalGenres(genres: string[]): string[] {
  return [...new Set(genres.map(canonicalGenre))];
}

/** Every stored spelling a filter for this genre must match at the SQL boundary. */
export function expandGenres(genres: string[]): string[] {
  const out: string[] = [];
  for (const genre of genres) {
    const canon = canonicalGenre(genre);
    const group = EQUIVALENT_GROUPS.find((g) => g[0] === canon);
    for (const name of group ?? [genre]) if (!out.includes(name)) out.push(name);
  }
  return out;
}
