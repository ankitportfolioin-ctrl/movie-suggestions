import React from 'react';
import { Movie } from '../types';
import { MovieCard } from './MovieCard';
import { Bookmark, ArrowLeft, Clapperboard } from 'lucide-react';

interface SavedPicksViewProps {
  saved: Movie[];
  onToggleSave: (movie: Movie) => void;
  onBack: () => void;
  onStartQuiz: () => void;
}

export const SavedPicksView: React.FC<SavedPicksViewProps> = ({
  saved,
  onToggleSave,
  onBack,
  onStartQuiz,
}) => {
  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 flex flex-col items-center space-y-8">
      <div className="w-full flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-[#8C8C8C] hover:text-[#F5F5F5] transition-colors duration-200 cursor-pointer"
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
        <span className="text-xs font-mono text-[#8C8C8C]">
          {saved.length} saved
        </span>
      </div>

      <div className="text-center max-w-lg space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#141414] border border-[#232323] text-xs font-medium tracking-wider uppercase text-[#FF7A2F]">
          <Bookmark size={13} />
          <span>Saved Picks</span>
        </div>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
          Your shortlist
        </h1>
        <p className="text-sm text-[#8C8C8C]">
          Picks you bookmarked for later. Stored only in this browser.
        </p>
      </div>

      {saved.length === 0 ? (
        <div className="flex flex-col items-center text-center max-w-md mx-auto space-y-5 py-8">
          <div className="w-14 h-14 rounded-full bg-[#141414] border border-[#232323] flex items-center justify-center text-[#FF7A2F]">
            <Clapperboard size={26} />
          </div>
          <p className="text-sm text-[#8C8C8C] leading-relaxed">
            No saved picks yet. Run the quiz and tap "Save pick" on anything
            worth remembering.
          </p>
          <button
            onClick={onStartQuiz}
            className="px-6 py-3.5 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-sm transition-all duration-200 hover:shadow-[0_0_20px_-4px_rgba(255,122,47,0.4)] cursor-pointer"
          >
            Find tonight's movie
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full items-stretch">
          {saved.map((movie, index) => (
            <MovieCard
              key={movie.id}
              movie={movie}
              index={index}
              saved
              onToggleSave={onToggleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
};
