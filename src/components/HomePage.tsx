import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  Sparkles,
  Film,
  Users,
  Heart,
  Baby,
  Clock,
  TrendingUp,
  Zap,
  Filter,
  X,
  Loader2,
  Brain,
  Laugh,
  Flower2,
  Droplet,
  Compass,
  Send,
} from 'lucide-react';
import { MoodSelector, MOOD_OPTIONS } from './MoodSelector';
import { FineTuneDrawer, INITIAL_WIZARD_STATE } from './FineTuneDrawer';
import { WizardState, ReferenceMovie } from '../types';

/** Four intent shortcuts shown on the homepage. */
interface IntentShortcut {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  primary?: boolean;
}

const INTENT_SHORTCUTS: IntentShortcut[] = [
  {
    id: 'pick-for-me',
    label: 'Pick for me',
    desc: 'Quick guided picks in 3 taps',
    icon: Sparkles,
    primary: true,
  },
  {
    id: 'browse-mood',
    label: 'Browse by mood',
    desc: 'Explore curated mood collections',
    icon: Heart,
  },
  {
    id: 'popular-now',
    label: 'Popular now',
    desc: 'What\'s trending this week',
    icon: TrendingUp,
  },
  {
    id: 'movies-series',
    label: 'Movies / Series',
    desc: 'Browse by type with filters',
    icon: Film,
  },
] as const;

/** Timely discovery collections row. */
const DISCOVERY_COLLECTIONS = [
  { label: `Best of ${new Date().getFullYear()}`, desc: 'Top-rated releases this year' },
  { label: 'New this week', desc: 'Fresh arrivals on streaming' },
  { label: 'Hidden gems', desc: 'Overlooked but excellent' },
  { label: 'Family night', desc: 'Safe picks for all ages' },
] as const;

/** Mood collections for "Browse by mood" expansion. */
interface MoodCollection {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const MOOD_COLLECTIONS: MoodCollection[] = [
  { id: 'mind-bending', label: 'Mind-bending', desc: 'Big ideas, reality shifts', icon: Zap },
  { id: 'suspenseful', label: 'Suspenseful', desc: 'Psychological, crime, thriller', icon: Brain },
  { id: 'funny', label: 'Funny', desc: 'Comedy that lands', icon: Laugh },
  { id: 'feel-good', label: 'Feel-good', desc: 'Uplifting, warm, rewarding', icon: Flower2 },
  { id: 'emotional', label: 'Emotional', desc: 'Moving, bittersweet, human', icon: Droplet },
  { id: 'adventurous', label: 'Adventurous', desc: 'High momentum, exploration', icon: Compass },
  { id: 'surprise', label: 'Surprise me', desc: 'Something unexpected', icon: Sparkles },
];

interface HomePageProps {
  onPickForMe: () => void;
  onBrowseMood: (moodId?: string) => void;
  onPopularNow: () => void;
  onMoviesSeries: () => void;
  onCollectionClick: (collection: string) => void;
  onSearchSubmit: (query: string, mode: 'title' | 'natural') => void;
  isLoading?: boolean;
}

export const HomePage: React.FC<HomePageProps> = ({
  onPickForMe,
  onBrowseMood,
  onPopularNow,
  onMoviesSeries,
  onCollectionClick,
  onSearchSubmit,
  isLoading = false,
}) => {
  const [searchMode, setSearchMode] = useState<'title' | 'natural'>('natural');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [showMoodCollections, setShowMoodCollections] = useState(false);
  const [showFineTune, setShowFineTune] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleIntentClick = (id: string) => {
    switch (id) {
      case 'pick-for-me':
        onPickForMe();
        break;
      case 'browse-mood':
        setShowMoodCollections(true);
        break;
      case 'popular-now':
        onPopularNow();
        break;
      case 'movies-series':
        onMoviesSeries();
        break;
    }
  };

  const handleMoodCollectionClick = (moodId: string) => {
    setShowMoodCollections(false);
    onBrowseMood(moodId);
  };

  const handleCollectionClick = (label: string) => {
    onCollectionClick(label);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchError('Type what you want to watch');
      return;
    }
    const minLength = searchMode === 'title' ? 2 : 3;
    if (q.length < minLength) {
      setSearchError(
        searchMode === 'title'
          ? 'Type at least 2 characters to search titles.'
          : 'Describe it in at least 3 characters.'
      );
      return;
    }
    setSearchError('');
    onSearchSubmit(q, searchMode);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    if (searchError) setSearchError('');
  };

  return (
    <div className="w-full flex flex-col items-center">
      {/* Hero Section */}
      <div className="flex flex-col items-center justify-center px-4 text-center max-w-3xl mx-auto pt-14 pb-12 sm:pt-20 sm:pb-16">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#141414] border border-[#232323] text-xs font-medium text-[#FF7A2F] mb-8 tracking-wider uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-[#E63946] animate-pulse" />
          <span>Pick tonight's movie in seconds</span>
        </div>

        <h1 className="font-heading text-4xl sm:text-6xl font-bold tracking-tight text-[#F5F5F5] leading-tight">
          Movie Night{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#E63946] to-[#FF7A2F]">
            Picker
          </span>
        </h1>

        <p className="mt-4 text-lg sm:text-xl text-[#8C8C8C] max-w-lg leading-relaxed">
          Choose a vibe or search a title. We'll give you tailored picks.
        </p>

        {/* Primary Search: "What do you feel like watching?" - Proper Form */}
        <div className="mt-8 w-full max-w-xl">
          <label htmlFor="hero-search" className="sr-only">
            What do you feel like watching?
          </label>
          <form onSubmit={handleSearchSubmit} className="relative">
            <div className="flex items-center">
              <Search className="absolute left-4 text-[#8C8C8C] w-5 h-5 pointer-events-none" aria-hidden="true" />
              <input
                type="text"
                id="hero-search"
                ref={inputRef}
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder='What do you feel like watching? e.g. "movies like Interstellar", "suspenseful but not scary", "best of 2020"'
                className="w-full pl-12 pr-14 py-4 rounded-[16px] bg-[#0A0A0A] border border-[#232323] focus:border-[#FF7A2F] text-[#F5F5F5] placeholder-[#8C8C8C] outline-none transition-all duration-200 text-base"
                maxLength={120}
                disabled={searchLoading}
                autoComplete="off"
                aria-describedby="hero-search-error"
              />
              {searchLoading && (
                <span className="absolute right-12 text-[#FF7A2F]" aria-hidden="true">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </span>
              )}
              <button
                type="submit"
                disabled={searchLoading || !searchQuery.trim()}
                className="absolute right-4 text-[#FF7A2F] hover:text-white transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Search"
              >
                <Send size={20} />
              </button>
            </div>
            {searchError && (
              <p id="hero-search-error" role="alert" className="mt-2 text-xs text-[#E63946] text-center">
                {searchError}
              </p>
            )}
          </form>
          <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3 text-xs text-[#8C8C8C]">
            <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#232323]">"like Interstellar"</span>
            <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#232323]">"suspenseful not scary"</span>
            <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#232323]">"best of 2020"</span>
            <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#232323]">"family tonight"</span>
          </div>
        </div>

        {/* Four Intent Shortcuts */}
        <div className="mt-10 w-full max-w-4xl">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {INTENT_SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut.id}
                onClick={() => handleIntentClick(shortcut.id)}
                disabled={isLoading}
                className={`p-4 rounded-[16px] border text-left transition-all duration-200 cursor-pointer flex flex-col items-start gap-2 ${
                  shortcut.primary
                    ? 'bg-gradient-to-br from-[#E63946]/10 to-[#FF7A2F]/10 border-[#FF7A2F]/30 hover:border-[#FF7A2F]/50 shadow-[0_0_20px_rgba(255,122,47,0.1)] text-white'
                    : 'bg-[#141414] border-[#232323] hover:border-[#353534] hover:bg-[#1a1a1a] text-[#8C8C8C] hover:text-white disabled:opacity-50'
                }`}
              >
                <div className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0">
                  <shortcut.icon
                    size={20}
                    className={shortcut.primary ? 'text-[#FF7A2F]' : 'text-[#8C8C8C] group-hover:text-[#FF7A2F] transition-colors'}
                  />
                </div>
                <span className="font-heading font-semibold">{shortcut.label}</span>
                <span className="text-[11px] leading-tight">{shortcut.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Mood Collections Expansion (shown when "Browse by mood" clicked) */}
        {showMoodCollections && (
          <div className="mt-8 w-full max-w-4xl animate-slide-down" role="region" aria-label="Mood collections">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading font-semibold text-lg text-[#F5F5F5]">Browse by mood</h2>
              <button
                onClick={() => setShowMoodCollections(false)}
                className="text-[#8C8C8C] hover:text-white transition-colors p-1"
                aria-label="Close mood collections"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {MOOD_COLLECTIONS.map((mood) => (
                <button
                  key={mood.id}
                  onClick={() => handleMoodCollectionClick(mood.id)}
                  disabled={isLoading}
                  className="p-4 rounded-[16px] border bg-[#141414] border-[#232323] hover:border-[#FF7A2F] hover:bg-[#1a1a1a] text-left transition-all duration-200 cursor-pointer disabled:opacity-50 flex flex-col items-start gap-2"
                >
                  <div className="w-10 h-10 rounded-[12px] bg-[#0A0A0A] border border-[#232323] flex items-center justify-center text-[#FF7A2F] flex-shrink-0">
                    <mood.icon size={20} />
                  </div>
                  <span className="font-heading font-semibold text-white">{mood.label}</span>
                  <span className="text-[11px] text-[#8C8C8C]">{mood.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Discovery Collections Row */}
        <div className="mt-10 w-full max-w-4xl">
          <p className="text-sm text-[#8C8C8C] text-center mb-4">Timely collections</p>
          <div className="flex flex-wrap justify-center gap-3">
            {DISCOVERY_COLLECTIONS.map((collection) => (
              <button
                key={collection.label}
                onClick={() => handleCollectionClick(collection.label)}
                disabled={isLoading}
                className="px-4 py-2.5 rounded-[12px] bg-[#141414] border border-[#232323] hover:border-[#FF7A2F] text-[#8C8C8C] hover:text-white font-medium text-sm transition-all duration-200 cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                <Film size={14} className="text-[#FF7A2F]" />
                <span>{collection.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Fine-tune (optional) */}
        <button
          onClick={() => setShowFineTune(true)}
          disabled={isLoading}
          className="mt-8 w-full sm:w-auto px-6 py-3 rounded-[12px] bg-[#141414] border border-[#232323] hover:border-[#FF7A2F] text-[#F5F5F5] font-medium text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-50"
        >
          <Filter className="w-4 h-4" />
          <span>Fine-tune filters (optional)</span>
        </button>

        {/* Saved Picks Link */}
        {/* Note: savedCount not passed anymore, handled by parent */}
      </div>

      {/* Features */}
      <div id="discover" className="w-full max-w-6xl mx-auto px-4 pb-14 scroll-mt-20">
        <h2 className="sr-only">Discover</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-6 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#383838] transition-colors">
            <div className="w-10 h-10 rounded-[12px] bg-[#0A0A0A] border border-[#232323] flex items-center justify-center text-[#FF7A2F] mb-4">
              <Sparkles size={19} />
            </div>
            <h3 className="font-heading font-semibold text-lg text-[#F5F5F5]">Emotion-First</h3>
            <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">We match your mental bandwidth, from tired and chilled to intense thrills.</p>
          </div>
          <div className="p-6 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#383838] transition-colors">
            <div className="w-10 h-10 rounded-[12px] bg-[#0A0A0A] border border-[#232323] flex items-center justify-center text-[#FF7A2F] mb-4">
              <Film size={19} />
            </div>
            <h3 className="font-heading font-semibold text-lg text-[#F5F5F5]">Streaming Ready</h3>
            <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">Find instant watch options across Netflix, Prime Video, Apple TV and more.</p>
          </div>
          <div className="p-6 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#383838] transition-colors">
            <div className="w-10 h-10 rounded-[12px] bg-[#0A0A0A] border border-[#232323] flex items-center justify-center text-[#FF7A2F] mb-4">
              <Sparkles size={19} />
            </div>
            <h3 className="font-heading font-semibold text-lg text-[#F5F5F5]">6–10 Curated Picks</h3>
            <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">A confident shortlist with clear reasons, not endless scrolling.</p>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div id="how-it-works" className="w-full border-t border-[#141414] scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4 py-14">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-[#FF7A2F] text-center">How it works</p>
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5] text-center mt-2">From "what to watch?" to "pressing play"</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
            <div className="p-6 rounded-[16px] bg-[#101010] border border-[#1f1f1f]">
              <span className="font-heading text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#E63946] to-[#FF7A2F]">01</span>
              <h3 className="font-heading font-semibold text-lg text-[#F5F5F5] mt-2">Search or pick a route</h3>
              <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">Type naturally or tap Pick for me / Browse mood / Popular now.</p>
            </div>
            <div className="p-6 rounded-[16px] bg-[#101010] border border-[#1f1f1f]">
              <span className="font-heading text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#E63946] to-[#FF7A2F]">02</span>
              <h3 className="font-heading font-semibold text-lg text-[#F5F5F5] mt-2">Get a confident shortlist</h3>
              <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">6–10 picks with clear reasons, not a catalogue.</p>
            </div>
            <div className="p-6 rounded-[16px] bg-[#101010] border border-[#1f1f1f]">
              <span className="font-heading text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#E63946] to-[#FF7A2F]">03</span>
              <h3 className="font-heading font-semibold text-lg text-[#F5F5F5] mt-2">Refine or press play</h3>
              <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">Tap filters, give feedback, or open watch options instantly.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Fine-tune Drawer */}
      <FineTuneDrawer
        isOpen={showFineTune}
        onClose={() => setShowFineTune(false)}
        wizardState={INITIAL_WIZARD_STATE}
        onChange={() => {}}
        disabled={isLoading}
      />
    </div>
  );
};