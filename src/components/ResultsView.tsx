import React, { useEffect, useState } from 'react';
import { Movie } from '../types';
import { MovieCard } from './MovieCard';
import { RotateCcw, RefreshCw, Repeat, Sparkles, AlertCircle, BadgeCheck, Info, RotateCw, SlidersHorizontal } from 'lucide-react';

interface ResultsViewProps {
  movies: Movie[];
  isLoading: boolean;
  loadError: boolean;
  // Optional user-facing cause (e.g. the 20s timeout), else generic copy.
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
  onNotForMe: (movie: Movie) => void;
  onSeenIt: (movie: Movie) => void;
  onWatchOptions: (movie: Movie) => void;
  onResetTaste: () => void;
  /** Result line of the last "Reset my taste" attempt ('' before any). */
  resetStatus: string;
}

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
  onNotForMe,
  onSeenIt,
  onWatchOptions,
  onResetTaste,
  resetStatus,
}) => {
  // Human, reassuring loading copy
  const loadingMessages = [
    'Finding three good options for tonight…',
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
    }, 2500); // Slower, more human pace
    return () => window.clearInterval(interval);
  }, [isLoading]);

  // Tasteful loading animation with stable status
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[65vh] px-4 text-center my-auto">
        <div className="relative flex items-center justify-center" aria-hidden="true">
          {/* Pulsing glow circles */}
          <div className="absolute w-28 h-28 rounded-full bg-gradient-to-r from-[#E63946] to-[#FF7A2F] opacity-30 blur-xl animate-pulse" />
          <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-[#E63946] to-[#FF7A2F] flex items-center justify-center shadow-[0_0_30px_rgba(255,122,47,0.5)]">
            <Sparkles className="w-8 h-8 text-white animate-spin" style={{ animationDuration: '4s' }} />
          </div>
        </div>
        {/* Stable status for assistive tech */}
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
        {/* Backend guidance (e.g. why nothing matched) shows even at zero */}
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

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 flex flex-col items-center space-y-10 animate-fade-in">
      {/* Header */}
      <div className="text-center max-w-xl space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#141414] border border-[#232323] text-xs font-medium tracking-wider uppercase text-[#FF7A2F]">
          <BadgeCheck size={14} />
          <span>Tonight's Picks</span>
        </div>
        <h1
          className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]"
          data-testid="results-heading"
        >
          {movies.length > 0 ? 'Your tailored matches' : 'No matches found'}
        </h1>
        <p className="text-sm text-[#8C8C8C]">
          Handpicked for your mood, runtime threshold, and language choice.
        </p>
      </div>

      {/* Partial-result notices: relaxed filters / note signals, stated plainly */}
      {notices.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-2xl px-4 py-3 rounded-[12px] bg-[#1c1b1b] border border-[#FF7A2F]/40 flex flex-col gap-1.5 -my-4"
        >
          {notices.map((n, i) => (
            <p key={i} className="text-xs text-[#d0d0d0] flex items-start gap-2 leading-relaxed">
              <Info size={13} className="text-[#FF7A2F] shrink-0 mt-0.5" />
              <span>{n}</span>
            </p>
          ))}
        </div>
      )}

      {/* Results: Top pick emphasized, others as alternatives */}
      {movies.length > 0 && (
        <div className="w-full space-y-6">
          {/* Top Pick - emphasized */}
          <div className="relative">
            <div className="absolute -top-3 left-4 z-10 px-3 py-1 rounded-full bg-gradient-to-r from-[#E63946] to-[#FF7A2F] text-white text-xs font-bold tracking-wider uppercase shadow-md">
              Tonight's pick
            </div>
            <MovieCard
              key={movies[0].id}
              movie={movies[0]}
              index={0}
              saved={savedIds.has(movies[0].id)}
              dismissed={dismissed.has(movies[0].id)}
              onToggleSave={onToggleSave}
              onMoreLike={onMoreLike}
              onNotForMe={onNotForMe}
              onSeenIt={onSeenIt}
              onWatchOptions={onWatchOptions}
            />
          </div>

          {/* Alternatives - lower visual weight */}
          {movies.length > 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="text-center py-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#141414] border border-[#232323] text-xs font-medium tracking-wider uppercase text-[#8C8C8C]">
                  <Sparkles size={12} />
                  <span>Alternatives</span>
                </span>
              </div>
              {movies.slice(1).map((movie, index) => (
                <MovieCard
                  key={movie.id}
                  movie={movie}
                  index={index + 1}
                  saved={savedIds.has(movie.id)}
                  dismissed={dismissed.has(movie.id)}
                  onToggleSave={onToggleSave}
                  onMoreLike={onMoreLike}
                  onNotForMe={onNotForMe}
                  onSeenIt={onSeenIt}
                  onWatchOptions={onWatchOptions}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Nudge + Actions */}
      <div className="flex flex-col items-center w-full max-w-2xl gap-4 pt-2">
        <p className="text-xs text-[#8C8C8C] text-center leading-relaxed">
          None of these hitting the exact spot? Cycle to an alternative cinematic
          triad or alter your constraints.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
          <button
            onClick={onMore}
            disabled={isLoading}
            className="w-full sm:flex-1 py-3.5 px-6 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_0_22px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Show me 3 more</span>
          </button>

          <button
            onClick={onCycle}
            disabled={isLoading}
            className="w-full sm:flex-1 py-3.5 px-6 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#FF7A2F] text-[#F5F5F5] font-medium text-sm flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_0_15px_-4px_rgba(255,122,47,0.25)] cursor-pointer disabled:opacity-50"
          >
            <Repeat className="w-4 h-4 text-[#8C8C8C]" />
            <span>Cycle 3 Alternates</span>
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
        {/* D-07: describe both halves of "Reset my taste" exactly */}
        <div className="text-[11px] text-[#8C8C8C] text-center leading-relaxed max-w-xl space-y-1.5">
          <p>
            Your saved picks and taste profile live in this browser. Quiz answers —
            including the optional note — are sent to our server to rank picks, and
            anonymous pick/feedback counts are stored server-side under a random id.
            No accounts, no trackers, no note text in analytics.
          </p>
          <p>
            <button
              onClick={onResetTaste}
              className="underline hover:text-[#F5F5F5] transition-colors cursor-pointer"
            >
              Reset my taste
            </button>{' '}
            — clears the taste profile and quiz state in this browser and deletes this
            device's anonymous counts from our server.
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
