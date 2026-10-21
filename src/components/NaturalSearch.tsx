import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, Sparkles, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { Movie } from '../types';

export interface SearchChip {
  id: string;
  label: string;
  type: 'genre' | 'mood' | 'year' | 'runtime' | 'audience' | 'reference' | 'custom';
  removable: boolean;
}

interface NaturalSearchProps {
  onSearch: (query: string, chips: SearchChip[]) => void;
  onClose: () => void;
  isLoading?: boolean;
  initialQuery?: string;
  initialChips?: SearchChip[];
}

// Parse natural language into chips (client-side heuristic; pure, so App can call it too)
export const parseQueryToChips = (q: string): SearchChip[] => {
  const lower = q.toLowerCase();
  const newChips: SearchChip[] = [];
  let chipId = 0;

  // Reference title: "like X" or "similar to X"
  const likeMatch = lower.match(/(?:like|similar to)\s+["']?([^"']+)["']?/);
  const refTitle = likeMatch
    ? likeMatch[1].split(/\s+(?:but|and|with|that|which|only|except|under|over|from|for|not|no|without)\b|[,;]/)[0].trim()
    : '';
  if (likeMatch && refTitle) {
    newChips.push({
      id: `ref-${chipId++}`,
      label: `like "${refTitle}"`,
      type: 'reference',
      removable: true,
    });
  }

  // Year: "best of 2020", "from 2019", "2020s"
  const yearMatch = lower.match(/(?:best of|from|in)\s+(19|20)\d{2}/) || lower.match(/\b(19|20)\d{2}s?\b/);
  if (yearMatch) {
    const year = yearMatch[0].match(/\d{4}/)?.[0] || yearMatch[0].match(/\d{2}/)?.[0];
    if (year) {
      newChips.push({
        id: `year-${chipId++}`,
        label: year.length === 2 ? `20${year}s` : year,
        type: 'year',
        removable: true,
      });
    }
  }

  // Mood/genre keywords
  const moodKeywords: Record<string, { label: string; type: 'mood' | 'genre' | 'audience' }> = {
    'mind.bending': { label: 'Mind-bending', type: 'mood' },
    'suspense': { label: 'Suspenseful', type: 'mood' },
    'thriller': { label: 'Thriller', type: 'genre' },
    'psychological': { label: 'Thriller', type: 'genre' },
    'crime': { label: 'Crime', type: 'genre' },
    'funny': { label: 'Funny', type: 'mood' },
    'comedy': { label: 'Comedy', type: 'genre' },
    'feel.good': { label: 'Feel-good', type: 'mood' },
    'uplifting': { label: 'Feel-good', type: 'mood' },
    'emotional': { label: 'Emotional', type: 'mood' },
    'moving': { label: 'Emotional', type: 'mood' },
    'bittersweet': { label: 'Emotional', type: 'mood' },
    'adventurous': { label: 'Adventurous', type: 'mood' },
    'adventure': { label: 'Adventure', type: 'genre' },
    'action': { label: 'Action', type: 'genre' },
    'sci.fi': { label: 'Sci-Fi', type: 'genre' },
    'space': { label: 'Sci-Fi', type: 'genre' },
    'fantasy': { label: 'Fantasy', type: 'genre' },
    'horror': { label: 'Horror', type: 'genre' },
    'scary': { label: 'Horror', type: 'genre' },
    'romance': { label: 'Romance', type: 'genre' },
    'romantic': { label: 'Romantic', type: 'mood' },
    'drama': { label: 'Drama', type: 'genre' },
    'documentary': { label: 'Documentary', type: 'genre' },
    'animation': { label: 'Animation', type: 'genre' },
    'animated': { label: 'Animation', type: 'genre' },
    'family': { label: 'Family', type: 'genre' },
  };

  // "not scary" / "without gore": the negated word must not become a chip.
  const negated = new Set([...lower.matchAll(/\b(?:not|no|without)\s+(\w+)/g)].map((m) => m[1]));

  for (const [keyword, config] of Object.entries(moodKeywords)) {
    // "." in a keyword means "space or hyphen or nothing" (feel-good, feel good,
    // sci-fi, sci fi); a trailing \w* lets "suspenseful" match "suspense".
    const regex = new RegExp(`\\b${keyword.replace('.', '[\\s-]?')}\\w*\\b`, 'i');
    const plain = keyword.replace('.', '');
    if (negated.has(plain) || negated.has(config.label.toLowerCase())) continue;
    if (regex.test(lower)) {
      newChips.push({
        id: `${config.type}-${chipId++}`,
        label: config.label,
        type: config.type,
        removable: true,
      });
    }
  }

  // Runtime: "under 90", "short", "long", "2 hours"
  const runtimeMatch = lower.match(/(?:under|less than)\s+(\d+)\s*(min|minute|hour)/) ||
                       lower.match(/(?:over|more than)\s+(\d+)\s*(min|minute|hour)/) ||
                       lower.match(/\b(\d+)\s*(hour|hr)\b/);
  if (runtimeMatch) {
    const num = parseInt(runtimeMatch[1], 10);
    const unit = runtimeMatch[2] || 'min';
    const mins = unit.startsWith('h') ? num * 60 : num;
    if (mins <= 90) {
      newChips.push({ id: `runtime-${chipId++}`, label: 'Under 90 min', type: 'runtime', removable: true });
    } else if (mins <= 120) {
      newChips.push({ id: `runtime-${chipId++}`, label: '90–120 min', type: 'runtime', removable: true });
    } else {
      newChips.push({ id: `runtime-${chipId++}`, label: 'Over 2 hours', type: 'runtime', removable: true });
    }
  } else if (/\bshort\b/.test(lower)) {
    newChips.push({ id: `runtime-${chipId++}`, label: 'Under 90 min', type: 'runtime', removable: true });
  } else if (/\blong\b/.test(lower) || /\bepic\b/.test(lower)) {
    newChips.push({ id: `runtime-${chipId++}`, label: 'Over 2 hours', type: 'runtime', removable: true });
  }

  // Audience: "for family", "for kids", "date night", "with friends"
  if (/\b(?:family|kids|children)\b/.test(lower)) {
    newChips.push({ id: `audience-${chipId++}`, label: 'Family / kids', type: 'audience', removable: true });
  } else if (/\b(?:date|partner|couple)\b/.test(lower)) {
    newChips.push({ id: `audience-${chipId++}`, label: 'Partner', type: 'audience', removable: true });
  } else if (/\b(?:friends|group|party)\b/.test(lower)) {
    newChips.push({ id: `audience-${chipId++}`, label: 'Friends', type: 'audience', removable: true });
  } else if (/\b(?:alone|solo|myself|just me)\b/.test(lower)) {
    newChips.push({ id: `audience-${chipId++}`, label: 'Just me', type: 'audience', removable: true });
  }

  // "not scary", "not horror", "but not X"
  const notMatches = lower.match(/(?:not|no|without)\s+(\w+)/g);
  if (notMatches) {
    notMatches.forEach((m) => {
      const word = m.replace(/(?:not|no|without)\s+/, '').trim();
      if (['scary', 'horror', 'gore', 'violence', 'sex', 'romance', 'comedy'].includes(word)) {
        newChips.push({
          id: `exclude-${chipId++}`,
          label: `No ${word}`,
          type: 'custom',
          removable: true,
        });
      }
    });
  }

  const seen = new Set<string>();
  return newChips.filter((c) => {
    const k = `${c.type}:${c.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Natural language search with interpreted, editable chips.
 * Translates "movies like Interstellar" → [sci-fi, space, big ideas, emotional] chips.
 */
export const NaturalSearch: React.FC<NaturalSearchProps> = ({
  onSearch,
  onClose,
  isLoading = false,
  initialQuery = '',
  initialChips = [],
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [chips, setChips] = useState<SearchChip[]>(initialChips);
  const [showChips, setShowChips] = useState(initialChips.length > 0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  // True once the user removes/clears/adds a chip by hand; until then the
  // chips are always re-derived from the text on submit (the live preview is
  // debounced, so a fast Enter could otherwise send stale or empty chips).
  const chipsEditedRef = useRef(false);

  // Sync with props
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    chipsEditedRef.current = false;
    setChips(initialChips);
    setShowChips(initialChips.length > 0);
  }, [initialChips]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setSearchError('');
    // Live chip preview as user types (debounced)
    clearTimeout(window.parseTimer);
    window.parseTimer = setTimeout(() => {
      const parsed = parseQueryToChips(value);
      if (parsed.length > 0) {
        setChips(parsed);
        setShowChips(true);
      }
    }, 300);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || query.trim().length < 3) {
      setSearchError('Describe what you want to watch (at least 3 characters)');
      return;
    }
    setSearchLoading(true);
    setSearchError('');
    clearTimeout(window.parseTimer);
    onSearch(query.trim(), chipsEditedRef.current ? chips : parseQueryToChips(query.trim()));
  };

  const removeChip = (chipId: string) => {
    chipsEditedRef.current = true;
    setChips((prev) => prev.filter((c) => c.id !== chipId));
  };

  const clearAllChips = () => {
    chipsEditedRef.current = true;
    setChips([]);
    setShowChips(false);
  };

  const addCustomChip = (label: string) => {
    if (!label.trim()) return;
    chipsEditedRef.current = true;
    setChips((prev) => [...prev, {
      id: `custom-${Date.now()}`,
      label: label.trim(),
      type: 'custom',
      removable: true,
    }]);
    setShowChips(true);
  };

  const chipTypeColors: Record<SearchChip['type'], string> = {
    genre: 'bg-[#1c1b1b] border-[#FF7A2F]/40 text-[#FF7A2F]',
    mood: 'bg-[#1c1b1b] border-[#E63946]/40 text-[#E63946]',
    year: 'bg-[#1c1b1b] border-[#3B82F6]/40 text-[#3B82F6]',
    runtime: 'bg-[#1c1b1b] border-[#22C55E]/40 text-[#22C55E]',
    audience: 'bg-[#1c1b1b] border-[#A855F7]/40 text-[#A855F7]',
    reference: 'bg-[#1c1b1b] border-[#F59E0B]/40 text-[#F59E0B]',
    custom: 'bg-[#1c1b1b] border-[#8C8C8C]/40 text-[#8C8C8C]',
  };

  return (
    <div className="w-full max-w-2xl mx-auto animate-slide-down" role="region" aria-label="Natural language search">
      <h1 className="sr-only">Describe what you want to watch</h1>
      <form onSubmit={handleSubmit} className="relative" role="search">
        {/* Search Input */}
        <div className="flex items-center gap-2">
          <Search className="absolute left-4 text-[#8C8C8C] w-5 h-5 pointer-events-none" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder='Describe what you want: "suspenseful but not scary", "like Interstellar but shorter", "best feel-good comedy of 2020"'
            className="w-full pl-12 pr-14 py-4 rounded-[16px] bg-[#0A0A0A] border border-[#232323] focus:border-[#FF7A2F] text-[#F5F5F5] placeholder-[#8C8C8C] outline-none transition-all duration-200 text-base"
            maxLength={200}
            disabled={searchLoading || isLoading}
            autoComplete="off"
            aria-label="Describe what you want to watch"
            aria-describedby="search-status"
          />
          {searchLoading && (
            <span className="absolute right-12 text-[#FF7A2F]" aria-hidden="true">
              <Loader2 className="w-5 h-5 animate-spin" />
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 text-[#8C8C8C] hover:text-white transition-colors p-1"
            aria-label="Close natural search"
          >
            <X size={20} />
          </button>
        </div>

        {/* Interpreted Chips - always visible when present */}
        {(chips.length > 0 || showChips) && (
          <div
            ref={chipsRef}
            className="mt-4 animate-slide-down"
            role="group"
            aria-label="Interpreted search filters"
          >
            <div className="flex items-center flex-wrap gap-2 mb-2">
              <span className="text-xs font-medium text-[#8C8C8C] uppercase tracking-wider">Understood as:</span>
              {chips.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllChips}
                  className="text-xs text-[#8C8C8C] hover:text-[#FF7A2F] transition-colors underline"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <span
                  key={chip.id}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${chipTypeColors[chip.type]} ${chip.removable ? 'cursor-pointer' : ''}`}
                >
                  <span>{chip.label}</span>
                  {chip.removable && (
                    <button
                      type="button"
                      onClick={() => removeChip(chip.id)}
                      className="ml-1 p-0.5 hover:bg-white/10 rounded-full transition-colors"
                      aria-label={`Remove ${chip.label}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              ))}
              {/* Add custom chip input */}
              <button
                type="button"
                onClick={() => {
                  const label = prompt('Add a custom filter (e.g. "Korean", "no jump scares", "Oscar winner"):');
                  if (label) addCustomChip(label);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#232323] text-xs text-[#8C8C8C] hover:border-[#353534] hover:text-white transition-colors cursor-pointer"
              >
                <Sparkles size={12} />
                <span>Add filter</span>
              </button>
            </div>
          </div>
        )}

        {/* Status/Error */}
        <div id="search-status" role="status" aria-live="polite" className="mt-2 text-center">
          {searchError && <p role="alert" className="text-xs text-[#E63946]">{searchError}</p>}
          {searchLoading && <p className="text-xs text-[#8C8C8C]">Searching…</p>}
        </div>
      </form>
    </div>
  );
};

// Extend Window for debounce timer
declare global {
  interface Window {
    parseTimer: ReturnType<typeof setTimeout>;
  }
}