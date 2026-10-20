import React, { useState, useRef, useEffect } from 'react';
import { Search, Sparkles, ArrowRight, Film, SlidersHorizontal, X } from 'lucide-react';
import { MoodSelector, getWizardMoodFromId, MOOD_OPTIONS } from './MoodSelector';
import { FineTuneDrawer, INITIAL_WIZARD_STATE } from './FineTuneDrawer';
import { WizardState, ReferenceMovie } from '../types';

export interface QuickPickProps {
  onGetRecommendations: (wizardState: WizardState & { referenceMovies?: ReferenceMovie[] }) => void;
  onSearchTitle: (query: string) => void;
  onSearchNatural: (query: string) => void;
  onOpenSaved: () => void;
  savedCount: number;
  isLoading?: boolean;
}

const INITIAL_MOOD = MOOD_OPTIONS[0].id; // 'surprise'

export const QuickPick: React.FC<QuickPickProps> = ({
  onGetRecommendations,
  onSearchTitle,
  onSearchNatural,
  onOpenSaved,
  savedCount,
  isLoading = false,
}) => {
  const [selectedMood, setSelectedMood] = useState<string>(INITIAL_MOOD);
  const [showFineTune, setShowFineTune] = useState(false);
  const [searchMode, setSearchMode] = useState<'title' | 'natural'>('title');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: number; title: string; year: number; genres: string[]; runtime: number; rating: number; overview: string; posterUrl: string; language: string }>>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchNotices, setSearchNotices] = useState<string[]>([]);
  const searchSeqRef = useRef(0);

  const fineTuneRef = useRef<WizardState & { referenceMovies?: ReferenceMovie[] }>({
    ...INITIAL_WIZARD_STATE,
    mood: getWizardMoodFromId(selectedMood),
  });

  // Sync mood selection to fine-tune state
  useEffect(() => {
    fineTuneRef.current = {
      ...fineTuneRef.current,
      mood: getWizardMoodFromId(selectedMood),
    };
  }, [selectedMood]);

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

  const handleSurpriseMe = () => {
    // Use the current fine-tune state with the selected mood
    onGetRecommendations(fineTuneRef.current);
  };

  const handleMoodPick = (moodId: string) => {
    setSelectedMood(moodId);
    // Immediately get recommendations with just the mood
    const state = {
      ...fineTuneRef.current,
      mood: getWizardMoodFromId(moodId),
    };
    onGetRecommendations(state);
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
          Choose a vibe or search a title. We'll give you three tailored picks.
        </p>

        {/* Primary Action: Surprise Me */}
        <button
          onClick={handleSurpriseMe}
          disabled={isLoading}
          className="mt-8 w-full sm:w-auto px-8 py-4 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-lg flex items-center justify-center gap-3 transition-all duration-200 hover:shadow-[0_0_25px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-6 h-6" aria-hidden="true" />
          <span>Surprise me</span>
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </button>

        {/* Mood Options */}
        <div className="mt-8 w-full max-w-2xl">
          <p className="text-sm text-[#8C8C8C] text-center mb-4">Or pick a mood:</p>
          <MoodSelector
            selectedMood={selectedMood}
            onSelect={handleMoodPick}
            disabled={isLoading}
          />
        </div>

        {/* Secondary: Fine-tune */}
        <button
          onClick={() => setShowFineTune(true)}
          disabled={isLoading}
          className="mt-8 w-full sm:w-auto px-6 py-3 rounded-[12px] bg-[#141414] border border-[#232323] hover:border-[#FF7A2F] text-[#F5F5F5] font-medium text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-50"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Fine-tune (optional)</span>
        </button>

        {/* Search Section */}
        <div className="mt-10 w-full max-w-xl border-t border-[#141414] pt-8">
          <p className="text-sm text-[#8C8C8C] text-center mb-4">I have a specific title or idea</p>
          <div className="mb-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setSearchMode('title')}
              disabled={searchLoading}
              className={`px-4 py-2 rounded-[10px] text-sm font-medium transition-all ${searchMode === 'title' ? 'bg-[#FF7A2F] text-black' : 'bg-[#141414] border border-[#232323] text-[#8C8C8C] hover:text-white hover:border-[#353534] disabled:opacity-50'}`}
            >
              Exact Title
            </button>
            <button
              onClick={() => setSearchMode('natural')}
              disabled={searchLoading}
              className={`px-4 py-2 rounded-[10px] text-sm font-medium transition-all ${searchMode === 'natural' ? 'bg-[#FF7A2F] text-black' : 'bg-[#141414] border border-[#232323] text-[#8C8C8C] hover:text-white hover:border-[#353534] disabled:opacity-50'}`}
            >
              Natural Language
            </button>
          </div>
          <form onSubmit={handleSearchSubmit} className="relative">
            <div className="flex items-center gap-2">
              <Search className="absolute left-3 text-[#8C8C8C] w-5 h-5 pointer-events-none" aria-hidden="true" />
              <input
                type="text"
                id="quick-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={searchMode === 'title' ? 'Search movies by exact title' : 'Describe what you want to watch'}
                aria-describedby="quick-search-status"
                placeholder={searchMode === 'title'
                  ? 'e.g. Interstellar, The Dark Knight, Parasite'
                  : 'e.g. "a space movie like Interstellar but shorter", "feel-good comedy for family"'}
                className="w-full pl-10 pr-4 py-3 rounded-[12px] bg-[#0A0A0A] border border-[#232323] focus:border-[#FF7A2F] text-[#F5F5F5] placeholder-[#8C8C8C] outline-none transition-all duration-200"
                maxLength={120}
                disabled={searchLoading}
              />
              {searchLoading && (
                <span className="absolute right-10 text-[#FF7A2F]" aria-hidden="true">
                  <Sparkles className="w-5 h-5 animate-spin" />
                </span>
              )}
            </div>
            <div id="quick-search-status" role="status" aria-live="polite">
              {searchLoading && <p className="mt-2 text-xs text-[#8C8C8C] text-center">Searching…</p>}
              {!searchLoading && searchError && <p role="alert" className="mt-2 text-xs text-[#E63946] text-center">{searchError}</p>}
              {!searchLoading && !searchError && showSearchResults && (
                <p className="mt-2 text-xs text-[#8C8C8C] text-center">
                  {searchResults.length === 0 ? 'No results found. Try a different query.' : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} found.`}
                </p>
              )}
              {!searchLoading && searchNotices.length > 0 && (
                <div className="mt-2 text-xs text-[#8C8C8C] text-center">
                  {searchNotices.map((n, i) => <p key={i}>{n}</p>)}
                </div>
              )}
            </div>
          </form>
          {showSearchResults && searchResults.length > 0 && (
            <div className="mt-6 w-full max-h-96 overflow-y-auto">
              <h2 className="text-sm font-medium text-[#8C8C8C] mb-3 text-left">Search Results</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
            </div>
          )}
        </div>

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
            <h3 className="font-heading font-semibold text-lg text-[#F5F5F5]">3 Curated Picks</h3>
            <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">Zero decision paralysis. Three hand-curated options including a hidden gem.</p>
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
              <h3 className="font-heading font-semibold text-lg text-[#F5F5F5] mt-2">Pick a mood or Surprise me</h3>
              <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">One tap gets you started. Optional filters if you want them.</p>
            </div>
            <div className="p-6 rounded-[16px] bg-[#101010] border border-[#1f1f1f]">
              <span className="font-heading text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#E63946] to-[#FF7A2F]">02</span>
              <h3 className="font-heading font-semibold text-lg text-[#F5F5F5] mt-2">Get 3 tailored matches</h3>
              <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">Curated triage with fit scores, including a hidden gem every time.</p>
            </div>
            <div className="p-6 rounded-[16px] bg-[#101010] border border-[#1f1f1f]">
              <span className="font-heading text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#E63946] to-[#FF7A2F]">03</span>
              <h3 className="font-heading font-semibold text-lg text-[#F5F5F5] mt-2">Press play tonight</h3>
              <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">Every pick shows where to stream it, so the decision ends in action.</p>
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