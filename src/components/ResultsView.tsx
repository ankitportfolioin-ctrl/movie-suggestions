import React, { useEffect, useState } from 'react';
import { Movie } from '../types';
import { MovieCard } from './MovieCard';
import {
  RotateCcw,
  RefreshCw,
  Repeat,
  Sparkles,
  AlertCircle,
  BadgeCheck,
  Info,
  RotateCw,
  SlidersHorizontal,
  Filter,
  X,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
} from 'lucide-react';
import { TYPE_OPTIONS, MOOD_OPTIONS_QUICK, AUDIENCE_OPTIONS, RUNTIME_OPTIONS, GENRE_OPTIONS, toggleGenre } from '../quickFilters';

interface FilterChip {
  key: string;
  label: string;
  value: string;
}

interface ResultsViewProps {
  movies: Movie[];
  isLoading: boolean;
  loadError: boolean;
  errorDetail?: string;
  notices: string[];
  onMore: () => void;
  onCycle: () => void;
  onReset: () => void;
  onRetry: () => void;
  onBackToFilters: () => void;
  saved: Movie[];
  dismissedIds: number[];
  onToggleSave: (movie: Movie) => void;
  onMoreLike: (movie: Movie) => void;
  onLessLike: (movie: Movie) => void;
  onNotForMe: (movie: Movie) => void;
  onSeenIt: (movie: Movie) => void;
  onWatchOptions: (movie: Movie) => void;
  onResetTaste: () => void;
  resetStatus: string;
  /** Current active filters for display */
  activeFilters?: FilterChip[];
  /** Available quick filter options */
  filterOptions?: {
    types?: string[];
    moods?: string[];
    audiences?: string[];
    runtimes?: string[];
  };
  /** Callback when filters change */
  onFilterChange?: (filters: Partial<{
    types: string[];
    moods: string[];
    audiences: string[];
    runtimes: string[];
    providers: string[];
    genres: string[];
  }>) => void;
  /** What is currently applied, so the one-tap bar can highlight it. */
  selected?: { types: string; moods: string; audiences: string; runtimes: string; genres: string[] };
}

interface QuickRow {
  key: 'types' | 'moods' | 'genres' | 'audiences' | 'runtimes';
  label: string;
  options: readonly string[];
  isActive: (o: string) => boolean;
  pick: (o: string) => void;
}

const QUICK_FILTER_GROUPS = [
  { key: 'types', label: 'Type', icon: Filter },
  { key: 'moods', label: 'Mood', icon: Sparkles },
  { key: 'audiences', label: 'Audience', icon: MoreHorizontal },
  { key: 'runtimes', label: 'Runtime', icon: RotateCw },
] as const;

export const ResultsView: React.FC<ResultsViewProps> = ({
  movies,
  isLoading,
  loadError,
  errorDetail,
  notices,
  onMore,
  onCycle,
  onReset,
  onRetry,
  onBackToFilters,
  saved,
  dismissedIds,
  onToggleSave,
  onMoreLike,
  onLessLike,
  onNotForMe,
  onSeenIt,
  onWatchOptions,
  onResetTaste,
  resetStatus,
  activeFilters = [],
  filterOptions = {},
  onFilterChange,
  selected,
}) => {
  const [showFilters, setShowFilters] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Human, reassuring loading copy
  const loadingMessages = [
    'Finding good options for tonight…',
    'Checking streaming availability…',
    'Ranking your best matches…',
    'Almost there…',
  ];
  const [messageIndex, setMessageIndex] = useState(0);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setMessageIndex(0);
      setShowTimeoutWarning(false);
      return;
    }
    const interval = window.setInterval(() => {
      setMessageIndex((i) => (i + 1) % loadingMessages.length);
    }, 2500);
    // Show timeout warning after 30 seconds
    const timeoutId = window.setTimeout(() => setShowTimeoutWarning(true), 30000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeoutId);
    };
  }, [isLoading]);

  // Tasteful loading animation with stable status
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[65vh] px-4 text-center my-auto">
        <div className="relative flex items-center justify-center" aria-hidden="true">
          <div className="absolute w-28 h-28 rounded-full bg-gradient-to-r from-[#E63946] to-[#FF7A2F] opacity-30 blur-xl animate-pulse" />
          <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-[#E63946] to-[#FF7A2F] flex items-center justify-center shadow-[0_0_30px_rgba(255,122,47,0.5)]">
            <Sparkles className="w-8 h-8 text-white animate-spin" style={{ animationDuration: '4s' }} />
          </div>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          Finding your picks. This can take up to 45 seconds.
        </p>
        <h2 className="font-heading text-2xl font-bold text-[#F5F5F5] mt-8 tracking-wide" aria-hidden="true">
          Finding your picks…
        </h2>
        <p className="text-sm text-[#8C8C8C] mt-2 h-6 transition-all" aria-hidden="true">
          {loadingMessages[messageIndex]}
        </p>
        {showTimeoutWarning && (
          <div className="mt-4 p-3 rounded-[12px] bg-[#E63946]/20 border border-[#E63946]/50 text-sm text-[#FF7A2F] max-w-md">
            <p className="font-medium">Taking longer than expected…</p>
            <p className="text-xs mt-1 opacity-80">The search is still running. You can wait a bit more or retry.</p>
            <button
              onClick={onRetry}
              className="mt-2 px-3 py-1.5 rounded-[8px] bg-[#E63946]/30 border border-[#E63946]/50 text-[#FF7A2F] hover:bg-[#E63946]/50 text-xs font-medium transition-all cursor-pointer"
            >
              Retry now
            </button>
          </div>
        )}
      </div>
    );
  }

  // Friendly empty state (also covers API errors distinctly)
  if (!movies || movies.length === 0) {
    return (
      <div
        role={loadError ? 'alert' : 'status'}
        className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center max-w-md mx-auto my-auto space-y-6"
      >
        <div className="w-14 h-14 rounded-full bg-[#141414] border border-[#232323] flex items-center justify-center text-[#FF7A2F]">
          <AlertCircle className="w-7 h-7" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#F5F5F5]">
            {loadError ? 'Something went wrong' : 'No perfect match'}
          </h1>
          <p className="text-sm text-[#8C8C8C] mt-2 leading-relaxed">
            {loadError
              ? errorDetail || 'Our movie services stumbled. Check your connection and try again.'
              : 'Try relaxing a few filters or broadening the runtime.'}
          </p>
        </div>
        {notices.length > 0 && (
          <div className="w-full px-4 py-3 rounded-[12px] bg-[#1c1b1b] border border-[#FF7A2F]/40 flex flex-col gap-1.5 -my-2">
            {notices.map((n, i) => (
              <p key={i} className="text-xs text-[#d0d0d0] flex items-start gap-2 leading-relaxed text-left">
                <Info size={13} className="text-[#FF7A2F] shrink-0 mt-0.5" />
                <span>{n}</span>
              </p>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3 w-full">
          {loadError ? (
            <button
              onClick={onRetry}
              className="flex-1 py-3.5 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_0_20px_-4px_rgba(255,122,47,0.4)] cursor-pointer"
            >
              <RotateCw className="w-4 h-4" />
              <span>Try again</span>
            </button>
          ) : (
            <button
              onClick={onBackToFilters}
              className="flex-1 py-3.5 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#FF7A2F] text-[#F5F5F5] font-medium text-sm transition-all duration-200 cursor-pointer"
            >
              Adjust filters
            </button>
          )}
          <button
            onClick={onReset}
            className="flex-1 py-3.5 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-medium text-sm transition-all duration-200 hover:shadow-[0_0_20px_-4px_rgba(255,122,47,0.4)] cursor-pointer"
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  const savedIds = new Set(saved.map((m) => m.id));
  const dismissed = new Set(dismissedIds);
  const hasActiveFilters = activeFilters.length > 0;

  const removeFilter = (filterKey: string, filterValue: string) => {
    // Map display labels to canonical API values
    const canonicalValue = mapToCanonical(filterKey, filterValue);
    onFilterChange?.({ [filterKey]: [] } as any);
    // Don't call onBackToFilters - let the parent handle refetch
  };

  const clearAllFilters = () => {
    onFilterChange?.({ types: [], moods: [], audiences: [], runtimes: [], providers: [], genres: [] } as any);
    // Don't call onBackToFilters - let the parent handle refetch
  };

  // Map display labels to canonical API values
  const mapToCanonical = (key: string, value: string): string => {
    const typeMap: Record<string, string> = {
      'Movie': 'movie',
      'Series': 'series',
      'Short film': 'short',
      'Any': 'any',
    };
    const moodMap: Record<string, string> = {
      'Mind-bending': 'Mind-bending',
      'Suspenseful': 'Suspenseful',
      'Funny': 'Funny',
      'Feel-good': 'Feel-good',
      'Emotional': 'Emotional',
      'Adventurous': 'Adventurous',
      'Surprise me': 'Surprise me',
    };
    const audienceMap: Record<string, string> = {
      'Just me': 'Just me',
      'Partner': 'Partner',
      'Friends': 'Friends',
      'Family with kids': 'Family with kids',
    };
    const runtimeMap: Record<string, string> = {
      'Under 90 min': 'Under 90 min',
      'Under 2 hours': 'Under 2 hours',
      'Under 2.5 hours': 'Under 2.5 hours',
      'Miniseries (1 season)': 'Miniseries (1 season)',
      'Any length': 'Any length',
    };

    switch (key) {
      case 'types': return typeMap[value] || value;
      case 'moods': return moodMap[value] || value;
      case 'audiences': return audienceMap[value] || value;
      case 'runtimes': return runtimeMap[value] || value;
      default: return value;
    }
  };

  const sel = selected ?? { types: 'Movie', moods: 'Surprise me', audiences: 'Just me', runtimes: 'Any length', genres: [] };
  const quickRows: QuickRow[] = [
    { key: 'types', label: 'Show me', options: TYPE_OPTIONS, isActive: (o) => sel.types === o, pick: (o) => onFilterChange?.({ types: [o] }) },
    { key: 'moods', label: 'Mood', options: MOOD_OPTIONS_QUICK, isActive: (o) => sel.moods === o, pick: (o) => onFilterChange?.({ moods: [o] }) },
    { key: 'genres', label: 'Genre', options: GENRE_OPTIONS, isActive: (o) => sel.genres.includes(o), pick: (o) => onFilterChange?.({ genres: toggleGenre(sel.genres, o) }) },
    { key: 'audiences', label: 'Watching', options: AUDIENCE_OPTIONS, isActive: (o) => sel.audiences === o, pick: (o) => onFilterChange?.({ audiences: [o] }) },
    {
      key: 'runtimes', label: 'Length',
      options: sel.types === 'Series' ? [...RUNTIME_OPTIONS, 'Miniseries (1 season)'] : RUNTIME_OPTIONS,
      isActive: (o) => sel.runtimes === o,
      pick: (o) => onFilterChange?.({ runtimes: [o] }),
    },
  ];

  const toggleFilterGroup = (groupKey: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 flex flex-col items-center space-y-8 animate-fade-in">
      {/* Header with filter toggle */}
      <div className="w-full max-w-4xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="text-center sm:text-left space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#141414] border border-[#232323] text-xs font-medium tracking-wider uppercase text-[#FF7A2F]">
              <BadgeCheck size={14} />
              <span>Your Picks</span>
            </div>
            <h1 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
              {movies.length > 0 ? `Found ${movies.length} matches` : 'No matches found'}
            </h1>
            <p className="text-sm text-[#8C8C8C]">
              Handpicked for your mood, runtime, and preferences.
            </p>
          </div>

          {/* Filter Toggle Button */}
          <div className="flex items-center gap-3">
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="px-3 py-2 rounded-[10px] bg-[#141414] border border-[#232323] hover:border-[#E63946] text-[#FF7A2F] hover:text-white text-sm font-medium transition-all duration-200 cursor-pointer"
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        {/* One-tap refine bar: always visible, every tap re-runs the search */}
        <div className="mb-6 space-y-2.5" role="region" aria-label="Refine your picks">
          {quickRows.map((row) => (
            <div key={row.key} className="flex items-center gap-3">
              <span className="w-[4.5rem] shrink-0 text-[11px] uppercase tracking-wider text-[#8C8C8C]">{row.label}</span>
              <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={row.label}>
                {row.options.map((option) => {
                  const active = row.isActive(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={isLoading}
                      onClick={() => row.pick(option)}
                      aria-pressed={active}
                      className={`shrink-0 px-3 py-1.5 rounded-full border text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-60 ${
                        active
                          ? 'bg-[#FF7A2F]/15 border-[#FF7A2F] text-white'
                          : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white'
                      }`}
                    >
                      {option === 'Any' ? 'Movies & Series' : option}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Partial-result notices */}
      {notices.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-4xl px-4 py-3 rounded-[12px] bg-[#1c1b1b] border border-[#FF7A2F]/40 flex flex-col gap-1.5"
        >
          {notices.map((n, i) => (
            <p key={i} className="text-xs text-[#d0d0d0] flex items-start gap-2 leading-relaxed">
              <Info size={13} className="text-[#FF7A2F] shrink-0 mt-0.5" />
              <span>{n}</span>
            </p>
          ))}
        </div>
      )}

      {/* Results Grid: 6-10 items */}
      <div className="w-full max-w-4xl space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {movies.map((movie, index) => (
            <MovieCard
              key={movie.id}
              movie={movie}
              index={index}
              saved={savedIds.has(movie.id)}
              dismissed={dismissed.has(movie.id)}
              onToggleSave={onToggleSave}
              onMoreLike={onMoreLike}
              onLessLike={onLessLike}
              onNotForMe={onNotForMe}
              onSeenIt={onSeenIt}
              onWatchOptions={onWatchOptions}
            />
          ))}
        </div>
      </div>

      {/* Load More / Actions */}
      <div className="w-full max-w-4xl flex flex-col items-center gap-4 pt-2">
        <p className="text-xs text-[#8C8C8C] text-center leading-relaxed">
          Want more options? Load additional picks or refine your filters.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
          <button
            onClick={onMore}
            disabled={isLoading}
            className="w-full sm:flex-1 py-3.5 px-6 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_0_22px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Load more</span>
          </button>

          <button
            onClick={onCycle}
            disabled={isLoading}
            className="w-full sm:flex-1 py-3.5 px-6 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#FF7A2F] text-[#F5F5F5] font-medium text-sm flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_0_15px_-4px_rgba(255,122,47,0.25)] cursor-pointer disabled:opacity-50"
          >
            <Repeat className="w-4 h-4 text-[#8C8C8C]" />
            <span>Different picks</span>
          </button>

          <button
            onClick={onBackToFilters}
            className="w-full sm:flex-1 py-3.5 px-6 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#FF7A2F] text-[#F5F5F5] font-medium text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4 text-[#8C8C8C]" />
            <span>Adjust filters</span>
          </button>

          <button
            onClick={onReset}
            className="w-full sm:flex-1 py-3.5 px-6 rounded-[16px] bg-transparent border border-[#232323] hover:border-[#383838] text-[#8C8C8C] hover:text-[#F5F5F5] font-medium text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Start over</span>
          </button>
        </div>

        {/* Privacy / Taste Reset */}
        <div className="text-[11px] text-[#8C8C8C] text-center leading-relaxed max-w-xl space-y-1.5">
          <p>
            Your saved picks and taste profile live in this browser. Searches and feedback
            are sent to our server to rank picks; anonymous counts stored under a random id.
            No accounts, no trackers.
          </p>
          <p>
            <button
              onClick={onResetTaste}
              className="underline hover:text-[#F5F5F5] transition-colors cursor-pointer"
            >
              Reset my taste
            </button>{' '}
            — clears local taste profile and deletes anonymous server counts.
          </p>
          {resetStatus && (
            <p role="status" aria-live="polite" data-testid="reset-status">
              {resetStatus}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};