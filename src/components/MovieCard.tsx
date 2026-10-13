import React, { useState } from 'react';
import { Movie } from '../types';
import { Star, Clock, BookmarkPlus, BookmarkCheck, ExternalLink, Shuffle } from 'lucide-react';

interface MovieCardProps {
  movie: Movie;
  index: number;
  saved?: boolean;
  onToggleSave?: (movie: Movie) => void;
  onMoreLike?: (movie: Movie) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({ movie, saved, onToggleSave, onMoreLike }) => {
  const [imageError, setImageError] = useState(false);
  const [brokenLogos, setBrokenLogos] = useState<Set<string>>(new Set());

  // Format runtime in hours and minutes
  const formatRuntime = (mins: number) => {
    if (!mins || mins <= 0) return '2h';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ''}` : `${m}m`;
  };

  const matchScore = movie.matchScore ?? 95;

  const handleWatchOptions = () => {
    window.open(
      `https://www.google.com/search?q=watch+${encodeURIComponent(movie.title)}+movie`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  return (
    <article className="group relative flex flex-col bg-[#141414] border border-[#232323] hover:border-[#FF7A2F]/50 rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-[0_0_24px_-6px_rgba(255,122,47,0.35)] w-full">
      {/* Hidden Gem Badge */}
      {movie.isHiddenGem && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#141414]/90 backdrop-blur-md border border-[#FF7A2F] text-[#FF7A2F] shadow-[0_0_16px_rgba(255,122,47,0.35)]">
          <Star size={13} className="fill-[#FF7A2F] text-[#FF7A2F]" />
          <span className="font-semibold text-[11px] tracking-wider uppercase">Hidden gem</span>
        </div>
      )}

      {/* Match Score Pill Tag */}
      <div className="absolute top-3 right-3 z-10 px-3 py-1 rounded-full bg-gradient-to-r from-[#E63946] to-[#FF7A2F] text-white text-xs font-bold shadow-md">
        {matchScore}% Match
      </div>

      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] w-full bg-[#0A0A0A] overflow-hidden">
        {!imageError && movie.posterUrl ? (
          <img
            src={movie.posterUrl}
            alt={movie.title}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-all duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#1c1c1c] to-[#121212]">
            <span className="font-heading text-lg font-bold text-[#F5F5F5]">{movie.title}</span>
            <span className="text-xs text-[#8C8C8C] mt-2">{movie.year}</span>
          </div>
        )}

        {/* Gradient overlay at bottom of poster */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-black/30 pointer-events-none" />
      </div>

      {/* Card Content */}
      <div className="p-6 flex-grow flex flex-col">
        <div>
          {/* Metadata Badges */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="px-2 py-0.5 rounded bg-[#0A0A0A] border border-[#232323] text-[#8C8C8C] text-xs">
              {movie.year}
            </span>
            <span className="px-2 py-0.5 rounded bg-[#0A0A0A] border border-[#232323] text-[#8C8C8C] text-xs flex items-center gap-1">
              <Clock size={11} className="text-[#FF7A2F]" />
              {formatRuntime(movie.runtime)}
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#0A0A0A] border border-[#232323] text-[#FF7A2F] text-xs font-semibold">
              <Star size={11} className="fill-[#FF7A2F] text-[#FF7A2F]" />
              <span>{movie.rating ? movie.rating.toFixed(1) : '7.5'}</span>
            </span>
            <span className="text-[#8C8C8C] text-xs">•</span>
            <span className="text-[#8C8C8C] text-xs">{movie.genres.slice(0, 3).join(', ')}</span>
          </div>

          {/* Title */}
          <h3 className="font-heading text-xl font-semibold text-white mb-2 tracking-tight line-clamp-1 group-hover:text-[#FF7A2F] transition-colors duration-200">
            {movie.title}
          </h3>

          {/* 2-Line Concise Synopsis */}
          <p className="text-sm text-[#8C8C8C] leading-relaxed line-clamp-2 mb-4 flex-grow">
            {movie.overview}
          </p>

          {/* 'Why this fits you' Pitch Callout */}
          <div className="p-3.5 rounded-[12px] bg-[#0A0A0A] border border-[#232323] mb-4">
            <div className="flex items-center gap-1.5 text-[#FF7A2F] text-[11px] uppercase font-semibold mb-1">
              <Star size={11} className="fill-[#FF7A2F]" />
              <span>Why this fits you</span>
            </div>
            <p className="text-sm text-[#F5F5F5] italic leading-snug line-clamp-3">
              "{movie.reason}"
            </p>
          </div>
        </div>

        {/* Streaming Platform Badges */}
        <div>
          <div className="text-[11px] font-medium text-[#8C8C8C] uppercase tracking-wider mb-2">
            Available On
          </div>

          {movie.providers && movie.providers.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              {movie.providers.slice(0, 4).map((p, idx) => (
                <span
                  key={`${p.name}-${idx}`}
                  title={`${p.name}${p.type ? ` (${p.type})` : ''}`}
                  className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-lg bg-[#1f1f1f] border border-[#2a2a2a] hover:border-[#FF7A2F] text-xs text-[#d0d0d0] transition-colors duration-200"
                >
                  <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[#202020] overflow-hidden shrink-0">
                    {p.logoUrl && !brokenLogos.has(p.logoUrl) ? (
                      <img
                        src={p.logoUrl}
                        alt=""
                        onError={() =>
                          setBrokenLogos((prev) => new Set(prev).add(p.logoUrl))
                        }
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-[8px] font-bold text-[#F5F5F5]">
                        {p.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span>{p.name}</span>
                  {p.type && <span className="opacity-60 text-[10px]">({p.type})</span>}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#8C8C8C] italic">
              Not available to stream in your country right now.
            </p>
          )}
        </div>
      </div>

      {/* Card Bottom Action */}
      <div className="px-4 py-3.5 border-t border-[#232323] bg-[#0e0e0e]/50 flex items-center justify-between gap-1">
        <button
          onClick={() => onToggleSave?.(movie)}
          className={`text-[13px] flex items-center gap-1.5 transition-colors cursor-pointer ${
            saved ? 'text-[#FF7A2F] font-semibold' : 'text-[#8C8C8C] hover:text-white'
          }`}
        >
          {saved ? <BookmarkCheck size={15} /> : <BookmarkPlus size={15} />}
          <span>{saved ? 'Saved' : 'Save pick'}</span>
        </button>

        <button
          onClick={() => onMoreLike?.(movie)}
          title="Find more movies like this one"
          className="text-[13px] text-[#8C8C8C] hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Shuffle size={14} />
          <span>More like this</span>
        </button>

        <button
          onClick={handleWatchOptions}
          className="text-[#FF7A2F] hover:text-white text-[13px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
        >
          <span>Watch options</span>
          <ExternalLink size={14} />
        </button>
      </div>
    </article>
  );
};
