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
  }>) => void;
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

  useEffect(() => {
    if (!isLoading) {
      setMessageIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      setMessageIndex((i) => (i + 1) % loadingMessages.length);
    }, 2500);
    return () => window.clearInterval(interval);
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
          Finding your picks. This can take up to 20 seconds.
        </p>
        <h2 className="font-heading text-2xl font-bold text-[#F5F5F5] mt-8 tracking-wide" aria-hidden="true">
          Finding your picks…
        </h2>
        <p className="text-sm text-[#8C8C8C] mt-2 h-6 transition-all" aria-hidden="true">
          {loadingMessages[messageIndex]}
        </p>
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
    onFilterChange?.({ [filterKey]: [] } as any); // Will be handled properly by parent
    // For now, trigger back to filters to let user adjust
    onBackToFilters();
  };

  const clearAllFilters = () => {
    onBackToFilters();
  };

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
                Clear all filters
              </button>
            )}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-[12px] bg-[#141414] border border-[#232323] hover:border-[#FF7A2F] text-[#F5F5F5] font-medium text-sm transition-all duration-200 cursor-pointer"
              aria-expanded={showFilters}
            >
              <Filter className="w-4 h-4" />
              <span>Filters</span>
              {hasActiveFilters && (
                <span className="px-2 py-0.5 rounded-full bg-[#FF7A2F]/20 text-[#FF7A2F] text-xs font-bold">
                  {activeFilters.length}
                </span>
              )}
              <span className={showFilters ? 'rotate-180' : ''} style={{ transition: 'transform 0.2s' }}>
                <ChevronDown className="w-4 h-4" />
              </span>
            </button>
          </div>
        </div>

        {/* Active Filter Chips */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2 mb-6" role="group" aria-label="Active filters">
            {activeFilters.map((filter) => (
              <span
                key={`${filter.key}-${filter.value}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1c1b1b] border border-[#FF7A2F]/40 text-xs text-[#F5F5F5]"
              >
                <span className="font-medium">{filter.label}</span>
                <span className="text-[#8C8C8C]">:</span>
                <span>{filter.value}</span>
                <button
                  type="button"
                  onClick={() => removeFilter(filter.key, filter.value)}
                  className="ml-1 p-0.5 hover:text-[#E63946] transition-colors"
                  aria-label={`Remove ${filter.label} filter`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Collapsible Filters Panel */}
        {showFilters && (
          <div className="animate-slide-down mb-6 p-4 rounded-[16px] bg-[#141414] border border-[#232323]" role="region" aria-label="Filter options">
            <div className="space-y-6">
              {QUICK_FILTER_GROUPS.map((group) => {
                const options = filterOptions[group.key as keyof typeof filterOptions] || [];
                if (options.length === 0) return null;

                const isExpanded = expandedGroups[group.key];
                return (
                  <div key={group.key} className="border-t border-[#232323] pt-4 first:border-0 first:pt-0">
                    <button
                      type="button"
                      onClick={() => toggleFilterGroup(group.key)}
                      className="w-full flex items-center justify-between text-left"
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-center gap-2">
                        <group.icon className="w-5 h-5 text-[#FF7A2F]" />
                        <span className="font-heading font-semibold text-white">{group.label}</span>
                      </div>
                      <span className={isExpanded ? 'rotate-180' : ''} style={{ transition: 'transform 0.2s' }}>
                        <ChevronDown className="w-4 h-4 text-[#8C8C8C]" />
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="mt-3 flex flex-wrap gap-2 animate-slide-down">
                        {options.map((option) => {
                          const isActive = activeFilters.some(
                            (f) => f.key === group.key && f.value === option
                          );
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => onFilterChange?.({ [group.key]: [option] } as any)}
                              className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all duration-200 cursor-pointer ${
                                isActive
                                  ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_10px_rgba(255,122,47,0.15)]'
                                  : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white'
                              }`}
                              aria-pressed={isActive}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* More filters link */}
              <div className="border-t border-[#232323] pt-4">
                <button
                  type="button"
                  onClick={onBackToFilters}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-[12px] bg-transparent border border-[#232323] hover:border-[#383838] text-[#8C8C8C] hover:text-[#F5F5F5] font-medium text-sm transition-all duration-200 cursor-pointer"
                >
                  <MoreHorizontal className="w-4 h-4" />
                  <span>More filters (year, rating, language, provider, sort…)</span>
                </button>
              </div>
            </div>
          </div>
        )}
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