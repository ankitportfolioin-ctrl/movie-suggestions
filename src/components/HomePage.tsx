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
} from 'lucide-react';
import { MoodSelector, MOOD_OPTIONS } from './MoodSelector';
import { FineTuneDrawer, INITIAL_WIZARD_STATE } from './FineTuneDrawer';
import { WizardState, ReferenceMovie } from '../types';

interface HomePageProps {
  onGetRecommendations: (wizardState: WizardState & { referenceMovies?: ReferenceMovie[] }) => void;
  onSearchTitle: (query: string) => void;
  onSearchNatural: () => void;
  onOpenSaved: () => void;
  savedCount: number;
  isLoading?: boolean;
  onPickForMe: () => void;
  onBrowseMood: (moodId?: string) => void;
  onPopularNow: () => void;
  onMoviesSeries: () => void;
  onCollectionClick: (collection: string) => void;
}

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
}

export const HomePage: React.FC<HomePageProps> = ({
  onGetRecommendations,
  onSearchTitle,
  onSearchNatural,
  onOpenSaved,
  savedCount,
  isLoading = false,
  onPickForMe,
  onBrowseMood,
  onPopularNow,
  onMoviesSeries,
  onCollectionClick,
}) => {
  const [searchMode, setSearchMode] = useState<'title' | 'natural'>('natural');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: number; title: string; year: number; genres: string[]; runtime: number; rating: number; overview: string; posterUrl: string; language: string }>>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchNotices, setSearchNotices] = useState<string[]>([]);
  const [showMoodCollections, setShowMoodCollections] = useState(false);
  const [showFineTune, setShowFineTune] = useState(false);
  const searchSeqRef = useRef(0);

  const fineTuneRef = useRef<WizardState & { referenceMovies?: ReferenceMovie[] }>({
    ...INITIAL_WIZARD_STATE,
    mood: 'Surprise me',
  });

  const readError = async (res: Response, fallback: string) => {
    try {
      const data = await res.json();
      if (typeof data?.error === 'string' && data.error) return data.error;
    } catch { /* non-JSON error body */ }
    return fallback;
  };

  const handleTitleSearch = async (query: string) => {
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const seq = ++searchSeqRef.current;
    const stale = () => seq !== searchSeqRef.current;
    setSearchLoading(true);
    setSearchError('');
    setSearchNotices([]);
    try {
      const res = await fetch(`/api/search-title?q=${encodeURIComponent(query.trim())}`);
      if (stale()) return;
      if (res.status === 429) throw new Error('RATE_LIMITED');
      if (!res.ok) throw new Error(await readError(res, 'Search failed. Please try again.'));
      const data = await res.json();
      if (stale()) return;
      setSearchResults(data.results || []);
      setShowSearchResults(true);
    } catch (e) {
      if (stale()) return;
      setSearchError(e instanceof Error && e.message === 'RATE_LIMITED'
        ? 'Too many searches, try again in a few minutes.'
        : e instanceof Error ? e.message : 'Search failed. Please try again.');
      setSearchResults([]);
    } finally {
      if (!stale()) setSearchLoading(false);
    }
  };

  const handleNaturalSearch = async (query: string) => {
    if (!query.trim() || query.trim().length < 3) {
      setSearchResults([]);
      return;
    }
    const seq = ++searchSeqRef.current;
    const stale = () => seq !== searchSeqRef.current;
    setSearchLoading(true);
    setSearchError('');
    setSearchNotices([]);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (stale()) return;
      if (res.status === 429) throw new Error('RATE_LIMITED');
      if (!res.ok) throw new Error(await readError(res, 'Search failed. Please try again.'));
      const data = await res.json();
      if (stale()) return;
      setSearchResults(data.movies || []);
      setSearchNotices(Array.isArray(data.notices) ? data.notices : []);
      setShowSearchResults(true);
    } catch (e) {
      if (stale()) return;
      setSearchError(e instanceof Error && e.message === 'RATE_LIMITED'
        ? 'Too many searches, try again in a few minutes.'
        : e instanceof Error ? e.message : 'Search failed. Please try again.');
      setSearchResults([]);
    } finally {
      if (!stale()) setSearchLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchError('Type what you want to watch');
      setSearchResults([]);
      setSearchNotices([]);
      setShowSearchResults(false);
      return;
    }
    const minLength = searchMode === 'title' ? 2 : 3;
    if (q.length < minLength) {
      setSearchError(
        searchMode === 'title'
          ? 'Type at least 2 characters to search titles.'
          : 'Describe it in at least 3 characters.'
      );
      setSearchResults([]);
      setSearchNotices([]);
      setShowSearchResults(false);
      return;
    }
    if (searchMode === 'title') {
      handleTitleSearch(q);
    } else {
      handleNaturalSearch(q);
    }
  };

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

        {/* Primary Search: "What do you feel like watching?" */}
        <div className="mt-8 w-full max-w-xl">
          <label htmlFor="hero-search" className="sr-only">
            What do you feel like watching?
          </label>
          <div className="relative">
            <div className="flex items-center">
              <Search className="absolute left-4 text-[#8C8C8C] w-5 h-5 pointer-events-none" aria-hidden="true" />
              <input
                type="text"
                id="hero-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='What do you feel like watching? e.g. "movies like Interstellar", "suspenseful but not scary", "best of 2020"'
                className="w-full pl-12 pr-14 py-4 rounded-[16px] bg-[#0A0A0A] border border-[#232323] focus:border-[#FF7A2F] text-[#F5F5F5] placeholder-[#8C8C8C] outline-none transition-all duration-200 text-base"
                maxLength={120}
                disabled={searchLoading}
                autoComplete="off"
              />
              {searchLoading && (
                <span className="absolute right-12 text-[#FF7A2F]" aria-hidden="true">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </span>
              )}
            </div>
          </div>
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

        {/* Search Results Display */}
        {showSearchResults && searchResults.length > 0 && (
          <div className="mt-8 w-full max-w-4xl animate-slide-down" role="region" aria-label="Search results">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading font-semibold text-lg text-[#F5F5F5]">Search Results</h2>
              <button
                onClick={() => { setShowSearchResults(false); setSearchQuery(''); }}
                className="text-[#8C8C8C] hover:text-white transition-colors p-1"
                aria-label="Clear search results"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
              {searchResults.map((movie) => (
                <button
                  type="button"
                  key={movie.id}
                  className="p-3 rounded-[12px] bg-[#141414] border border-[#232323] hover:border-[#383838] focus-visible:ring-2 focus-visible:ring-[#FF7A2F] transition-colors cursor-pointer group text-left"
                  onClick={() => {
                    setSearchQuery(movie.title);
                    handleTitleSearch(movie.title);
                  }}
                >
                  <div className="relative aspect-[2/3] rounded-[8px] overflow-hidden bg-[#232323] mb-2">
                    {movie.posterUrl ? (
                      <img src={movie.posterUrl} alt="" aria-hidden="true" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : null}
                  </div>
                  <span className="block font-medium text-white text-sm truncate group-hover:text-[#FF7A2F] transition-colors">{movie.title}</span>
                  <p className="text-xs text-[#8C8C8C] mt-1">{movie.year} • {movie.genres.slice(0, 2).join(', ')} • {movie.runtime}m • {movie.rating}/10</p>
                </button>
              ))}
            </div>
            {searchNotices.length > 0 && (
              <div className="mt-3 p-3 rounded-[12px] bg-[#1c1b1b] border border-[#FF7A2F]/40 text-xs text-[#d0d0d0]">
                {searchNotices.map((n, i) => <p key={i}>{n}</p>)}
              </div>
            )}
          </div>
        )}

        {showSearchResults && searchResults.length === 0 && !searchLoading && !searchError && (
          <div className="mt-8 w-full max-w-4xl text-center text-[#8C8C8C]">
            <p>No results found. Try a different query.</p>
          </div>
        )}

        {/* Saved Picks Link */}
        {savedCount > 0 && (
          <button
            onClick={onOpenSaved}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-[12px] bg-[#141414] border border-[#232323] hover:border-[#FF7A2F] text-[#8C8C8C] hover:text-[#F5F5F5] font-medium text-sm transition-all duration-200 cursor-pointer"
          >
            <Film className="w-4 h-4" />
            <span>{savedCount} saved pick{savedCount !== 1 ? 's' : ''}</span>
          </button>
        )}
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
        wizardState={fineTuneRef.current}
        onChange={(updates) => { fineTuneRef.current = { ...fineTuneRef.current, ...updates }; }}
        disabled={isLoading}
      />
    </div>
  );
};