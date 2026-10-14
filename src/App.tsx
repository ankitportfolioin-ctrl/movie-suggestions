import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Award,
  Bookmark,
  Clapperboard,
  Smile,
  Tv,
  Search,
  Sparkles,
} from 'lucide-react';
import { WizardState, Movie } from './types';
import { Wizard } from './components/Wizard';
import { ResultsView } from './components/ResultsView';
import { SavedPicksView } from './components/SavedPicksView';
import {
  getAnonId,
  resetTaste,
  sendFeedbackEvent,
  type ImpressionToken,
} from './feedback';
import {
  getTasteVector,
  setTasteVector,
  applyDecay,
  updateTasteFromEvent,
  getTastePayload,
} from './taste';

const INITIAL_STATE: WizardState = {
  step: 0,
  mood: 'Relaxed',
  genres: ['Surprise me'],
  audience: 'Just me',
  maxRuntime: 'Under 2 hours',
  languages: ['Any'],
  preferences: {
    highlyRated: false,
    hiddenGems: false,
    recent: false,
    classics: false,
    mature: false,
  },
  note: '',
};

const SAVED_KEY = 'cinematch:saved-picks:v1';
const QUIZ_KEY = 'cinematch:quiz-state:v1';

function loadSaved(): Movie[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.id === 'number') : [];
  } catch {
    return [];
  }
}

interface StoredQuiz {
  wizard: WizardState;
  movies: Movie[];
  notices: string[];
  seen: number[];
  touched: number[];
}

function loadQuiz(): StoredQuiz | null {
  try {
    const raw = sessionStorage.getItem(QUIZ_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.wizard?.step !== 'number') return null;
    // Never restore into the results view without movies to show.
    const step = parsed.wizard.step >= 8 && !(parsed.movies || []).length ? 0 : parsed.wizard.step;
    return {
      wizard: { ...INITIAL_STATE, ...parsed.wizard, step },
      movies: Array.isArray(parsed.movies) ? parsed.movies : [],
      notices: Array.isArray(parsed.notices) ? parsed.notices : [],
      seen: Array.isArray(parsed.seen) ? parsed.seen : [],
      touched: Array.isArray(parsed.touched) ? parsed.touched : [],
    };
  } catch {
    return null;
  }
}

const FEATURES = [
  {
    icon: Smile,
    title: 'Emotion-First',
    desc: 'We match your mental bandwidth, from tired and chilled to intense thrills.',
  },
  {
    icon: Tv,
    title: 'Streaming Ready',
    desc: 'Find instant watch options across Netflix, Prime Video, Apple TV and more.',
  },
  {
    icon: Award,
    title: '3 Curated Picks',
    desc: 'Zero decision paralysis. Three hand-curated options including a hidden gem.',
  },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Answer 7 quick questions',
    desc: 'Mood, genres, company, runtime, language and a note. Done in under a minute.',
  },
  {
    step: '02',
    title: 'Get 3 tailored matches',
    desc: 'A curated triage with match scores, including one hidden gem every time.',
  },
  {
    step: '03',
    title: 'Press play tonight',
    desc: 'Every pick shows where to stream it, so the decision ends in action.',
  },
];

export default function App() {
  const [wizardState, setWizardState] = useState<WizardState>(() => loadQuiz()?.wizard ?? INITIAL_STATE);
  const [movies, setMovies] = useState<Movie[]>(() => loadQuiz()?.movies ?? []);
  const [notices, setNotices] = useState<string[]>(() => loadQuiz()?.notices ?? []);
  const [loadError, setLoadError] = useState(false);
  const [seenMovieIds, setSeenMovieIds] = useState<number[]>(() => loadQuiz()?.seen ?? []);
  const [isLoading, setIsLoading] = useState(false);
  // Signed impression tokens for the currently shown picks (Step 1/2 learning).
  const [impressionTokens, setImpressionTokens] = useState<ImpressionToken[]>([]);
  // Movies the user dismissed via Seen it / Not for me (excluded going forward).
  const [dismissedIds, setDismissedIds] = useState<number[]>([]);
  // Taste learning: number of feedback events this anonId has sent (for confidence ramp).
  const [tasteEventCount, setTasteEventCount] = useState(() => {
    try {
      const raw = localStorage.getItem('cinematch:taste:eventCount');
      return raw ? parseInt(raw, 10) : 0;
    } catch {
      return 0;
    }
  });
  const [showSaved, setShowSaved] = useState(false);
  const [saved, setSaved] = useState<Movie[]>(loadSaved);
  // Steps the user has actively answered (drives the Session Snapshot).
  const [touched, setTouched] = useState<number[]>(() => loadQuiz()?.touched ?? []);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch {
      // Private mode etc: saved picks simply won't persist.
    }
  }, [saved]);

  // Persist quiz progress across refresh (session scope only).
  useEffect(() => {
    try {
      const payload: StoredQuiz = {
        wizard: wizardState,
        movies,
        notices,
        seen: seenMovieIds,
        touched,
      };
      sessionStorage.setItem(QUIZ_KEY, JSON.stringify(payload));
    } catch {
      // Storage unavailable: quiz simply won't survive refresh.
    }
  }, [wizardState, movies, notices, seenMovieIds, touched]);

  // D-SCROLL-01: reset scroll on step change so small screens never
  // open mid-question with a clipped heading.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [wizardState.step]);

  // Step 3: apply taste decay once per page load.
  useEffect(() => {
    const anon = getAnonId();
    if (anon && anon !== 'none') applyDecay(anon);
  }, []);

  // Update wizard properties
  const handleUpdate = (updates: Partial<WizardState>) => {
    setWizardState((prev) => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    const step = wizardState.step;
    setTouched((t) => (t.includes(step) ? t : [...t, step]));
    setWizardState((prev) => ({ ...prev, step: prev.step + 1 }));
  };

  const handleSubmit = () => {
    setTouched((t) => (t.includes(7) ? t : [...t, 7]));
    fetchRecommendations([]);
  };

  const handleBack = () => {
    setWizardState((prev) => ({ ...prev, step: Math.max(0, prev.step - 1) }));
  };

  const handleCancel = () => {
    // Phase 4: explicit confirmation, then a clear reset (answers cleared).
    if (window.confirm('Quit the quiz? Your answers will be cleared.')) {
      setShowSaved(false);
      setWizardState(INITIAL_STATE);
      setTouched([]);
    }
  };

  const handleBackToFilters = () => {
    setWizardState((prev) => ({ ...prev, step: 6 }));
  };

  const handleReset = () => {
    setWizardState(INITIAL_STATE);
    setMovies([]);
    setNotices([]);
    setLoadError(false);
    setSeenMovieIds([]);
    setTouched([]);
    setImpressionTokens([]);
    setDismissedIds([]);
  };

  const tokenFor = (movieId: number): ImpressionToken | undefined =>
    impressionTokens.find((t) => t.movieId === movieId);

  const toggleSave = (movie: Movie) => {
    const isSaving = !saved.some((m) => m.id === movie.id);
    setSaved((prev) =>
      prev.some((m) => m.id === movie.id)
        ? prev.filter((m) => m.id !== movie.id)
        : [...prev, movie]
    );
    // Unsaving is ambiguous (cleanup, not dislike): only saves send a signal.
    if (isSaving) {
      const tok = tokenFor(movie.id);
      if (tok) void sendFeedbackEvent(tok, 'save');
      const anon = getAnonId();
      if (anon && anon !== 'none') {
        updateTasteFromEvent(anon, movie, 'save');
        setTasteEventCount((c) => c + 1);
      }
    }
  };

  const dismissMovie = (movie: Movie, action: 'seen_it' | 'not_for_me') => {
    const tok = tokenFor(movie.id);
    if (tok) void sendFeedbackEvent(tok, action);
    // Never shown again: fold into the exclusion list for future fetches.
    setSeenMovieIds((prev) => (prev.includes(movie.id) ? prev : [...prev, movie.id]));
    setDismissedIds((prev) => (prev.includes(movie.id) ? prev : [...prev, movie.id]));
    // Taste update for not_for_me
    if (action === 'not_for_me') {
      const anon = getAnonId();
      if (anon && anon !== 'none') {
        updateTasteFromEvent(anon, movie, 'not_for_me');
        setTasteEventCount((c) => c + 1);
      }
    }
  };

  const handleNotForMe = (movie: Movie) => dismissMovie(movie, 'not_for_me');
  const handleSeenIt = (movie: Movie) => dismissMovie(movie, 'seen_it');

  const handleWatchOptions = (movie: Movie) => {
    const tok = tokenFor(movie.id);
    if (tok) void sendFeedbackEvent(tok, 'provider_click');
  };

  const handleResetTaste = () => {
    // Clears the anonymous taste profile on this device (Step 3).
    resetTaste();
    const anon = getAnonId();
    if (anon && anon !== 'none') {
      setTasteVector(anon, {});
      localStorage.removeItem('cinematch:taste:eventCount');
    }
    setTasteEventCount(0);
    setDismissedIds([]);
  };

  // Fetch recommendations from /api/recommend
  const fetchRecommendations = async (
    customExclude?: number[],
    resetHistory = false,
    genreOverride?: string[]
  ) => {
    setIsLoading(true);
    setLoadError(false);
    setShowSaved(false);
    setWizardState((prev) => ({ ...prev, step: 8 })); // Results view

    const currentExcludes = customExclude ?? seenMovieIds;

    try {
      const anon = getAnonId();
      const tastePayload = getTastePayload(anon, tasteEventCount);
      const referenceIds = (wizardState.referenceMovies || []).map((r) => r.imdbId);
      const payload = {
        mood: wizardState.mood,
        genres: genreOverride ?? wizardState.genres,
        audience: wizardState.audience,
        maxRuntime: wizardState.maxRuntime,
        languages: wizardState.languages,
        preferences: wizardState.preferences,
        note: wizardState.note,
        excludeIds: currentExcludes,
        anonId: anon,
        taste: tastePayload,
        referenceIds,
      };

      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // D-TIMEOUT-01: never wait forever; 20s then friendly error state.
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        throw new Error('Failed to fetch recommendations');
      }

      const data = await res.json();
      const newMovies: Movie[] = Array.isArray(data.movies) ? data.movies : [];
      setNotices(
        Array.isArray(data.notices) ? data.notices.filter((n: unknown) => typeof n === 'string') : []
      );
      setImpressionTokens(
        Array.isArray(data.impressionTokens)
          ? data.impressionTokens.filter(
              (t: unknown): t is ImpressionToken =>
                !!t && typeof (t as ImpressionToken).movieId === 'number' &&
                typeof (t as ImpressionToken).impressionId === 'string' &&
                typeof (t as ImpressionToken).token === 'string'
            )
          : []
      );

      setMovies(newMovies);
      const newIds = newMovies.map((m) => m.id);
      setSeenMovieIds((prev) =>
        resetHistory ? newIds : Array.from(new Set([...prev, ...newIds]))
      );
    } catch {
      // In case of error, set empty movies so error state is shown cleanly
      setMovies([]);
      setNotices([]);
      setImpressionTokens([]);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMore = () => {
    fetchRecommendations();
  };

  const MORE_LIKE_GENRES = new Set([
    'Surprise me', 'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
    'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror', 'Mystery',
    'Romance', 'Sci-Fi', 'Thriller',
  ]);

  const handleMoreLike = (movie: Movie) => {
    const tok = tokenFor(movie.id);
    if (tok) void sendFeedbackEvent(tok, 'more_like_this');
    // Seed a fresh search from this movie's own genres, excluding seen titles.
    const seeded = movie.genres.filter((g) => MORE_LIKE_GENRES.has(g)).slice(0, 2);
    const nextGenres = seeded.length > 0 ? seeded : ['Surprise me'];
    setWizardState((prev) => ({ ...prev, genres: nextGenres }));
    fetchRecommendations(undefined, false, nextGenres);
  };

  const handleCycle = () => {
    // "Show different picks": one negative signal per rejected pick.
    const anon = getAnonId();
    for (const m of movies) {
      const tok = tokenFor(m.id);
      if (tok) void sendFeedbackEvent(tok, 'different_picks');
      if (anon && anon !== 'none') {
        updateTasteFromEvent(anon, m, 'different_picks');
        setTasteEventCount((c) => c + 1);
      }
    }
    // Fresh rotation: deal a new triad excluding only what's on screen,
    // forgetting older history so the pool stays large.
    const currentIds = movies.map((m) => m.id);
    fetchRecommendations(currentIds, true);
  };

  const scrollToSection = (id: string) => {
    if (showSaved || wizardState.step !== 0) {
      setShowSaved(false);
      setWizardState((prev) => ({ ...prev, step: 0 }));
      window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }, 80);
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Progress Bar calculation (steps 1 through 7)
  const progressPercent =
    wizardState.step === 0
      ? 0
      : wizardState.step >= 8
      ? 100
      : Math.round((wizardState.step / 7) * 100);

  const showHeader = !showSaved && wizardState.step !== 0 && wizardState.step < 8 ? false : true;

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F5] flex flex-col justify-between selection:bg-[#E63946]/30 selection:text-[#F5F5F5]">
      {/* Thin red-to-orange progress bar at top (quiz only) */}
      {wizardState.step > 0 && wizardState.step < 8 && !showSaved && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-[#1a1a1a] z-50 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#E63946] to-[#FF7A2F] transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* CineMatch header */}
      {showHeader && (
        <header className="sticky top-0 z-40 bg-[#0A0A0A]/85 backdrop-blur-md border-b border-[#141414]">
          <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between gap-4">
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 font-heading font-bold text-lg tracking-tight text-[#F5F5F5] hover:text-white transition-colors cursor-pointer"
            >
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#E63946] to-[#FF7A2F] flex items-center justify-center">
                <Clapperboard size={18} className="text-white" />
              </span>
              <span>CineMatch</span>
            </button>

            <nav className="hidden sm:flex items-center gap-7 text-sm text-[#8C8C8C]">
              <button
                onClick={() => scrollToSection('discover')}
                className="hover:text-[#F5F5F5] transition-colors cursor-pointer"
              >
                Discover
              </button>
              <button
                onClick={() => scrollToSection('how-it-works')}
                className="hover:text-[#F5F5F5] transition-colors cursor-pointer"
              >
                How It Works
              </button>
              <button
                onClick={() => setShowSaved(true)}
                className="hover:text-[#F5F5F5] transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Bookmark size={14} />
                <span>Saved Picks</span>
                {saved.length > 0 && (
                  <span className="min-w-5 h-5 px-1 rounded-full bg-[#FF7A2F] text-black text-[11px] font-bold flex items-center justify-center">
                    {saved.length}
                  </span>
                )}
              </button>
            </nav>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSaved(true)}
                className="sm:hidden w-9 h-9 rounded-[12px] bg-[#141414] border border-[#232323] flex items-center justify-center text-[#8C8C8C] hover:text-[#F5F5F5] hover:border-[#383838] transition-colors cursor-pointer relative"
                aria-label="Saved picks"
              >
                <Bookmark size={16} />
                {saved.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-[#FF7A2F] text-black text-[11px] font-bold flex items-center justify-center">
                    {saved.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  setShowSaved(false);
                  setWizardState((prev) => ({ ...prev, step: 1 }));
                  window.scrollTo({ top: 0 });
                }}
                className="px-4 sm:px-5 py-2.5 rounded-[12px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-sm flex items-center gap-2 transition-all duration-200 hover:shadow-[0_0_20px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                <span>Start Quiz</span>
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main className="flex-grow flex flex-col justify-center items-center w-full">
        {showSaved ? (
          <SavedPicksView
            saved={saved}
            onToggleSave={toggleSave}
            onBack={() =>
              movies.length > 0
                ? (setShowSaved(false), setWizardState((prev) => ({ ...prev, step: 8 })))
                : handleCancel()
            }
            onStartQuiz={() => {
              setShowSaved(false);
              setWizardState((prev) => ({ ...prev, step: 1 }));
              window.scrollTo({ top: 0 });
            }}
          />
        ) : wizardState.step < 8 ? (
          wizardState.step === 0 ? (
            <Hero
              onStart={() => setWizardState((prev) => ({ ...prev, step: 1 }))}
            />
          ) : (
            <Wizard
              state={wizardState}
              onChange={handleUpdate}
              onNext={handleNext}
              onBack={handleBack}
              onCancel={handleCancel}
              onSubmit={handleSubmit}
              isLoading={isLoading}
              touchedSteps={touched}
            />
          )
        ) : (
          <ResultsView
            movies={movies}
            isLoading={isLoading}
            loadError={loadError}
            notices={notices}
            onMore={handleMore}
            onCycle={handleCycle}
            onReset={handleReset}
            onRetry={() => fetchRecommendations()}
            onBackToFilters={handleBackToFilters}
            saved={saved}
            dismissedIds={dismissedIds}
            onToggleSave={toggleSave}
            onMoreLike={handleMoreLike}
            onNotForMe={handleNotForMe}
            onSeenIt={handleSeenIt}
            onWatchOptions={handleWatchOptions}
            onResetTaste={handleResetTaste}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="w-full shrink-0 border-t border-[#141414]">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Clapperboard size={15} className="text-[#FF7A2F]" />
            <span className="font-heading font-semibold text-[#F5F5F5]">CineMatch</span>
            <span className="text-[#8C8C8C] text-xs">© 2026 CineMatch.</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-[#8C8C8C]">
            <a href="https://www.omdbapi.com/" target="_blank" rel="noopener noreferrer" className="hover:text-[#FF7A2F] transition-colors">OMDb</a>
            <span>·</span>
            <a href="https://watchmode.com/" target="_blank" rel="noopener noreferrer" className="hover:text-[#FF7A2F] transition-colors">Watchmode</a>
            <span>·</span>
            <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" className="hover:text-[#FF7A2F] transition-colors">TMDB</a>
          </div>
        </div>
        <div className="w-full pb-4 text-center text-[11px] text-[#8C8C8C]">
          <span>No accounts · No tracking · Your picks stay in this browser</span>
        </div>
      </footer>
    </div>
  );
}

function Hero({ onStart }: { onStart: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: number; title: string; year: number; genres: string[]; runtime: number; rating: number; overview: string; posterUrl: string; language: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [searchMode, setSearchMode] = useState<'title' | 'natural'>('title');

  const handleTitleSearch = async (query: string) => {
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    setSearchError('');
    try {
      const res = await fetch(`/api/search-title?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setSearchResults(data.results || []);
      setShowResults(true);
    } catch {
      setSearchError('Search failed. Please try again.');
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleNaturalSearch = async (query: string) => {
    if (!query.trim() || query.trim().length < 3) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    setSearchError('');
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setSearchResults(data.movies || []);
      setShowResults(true);
    } catch {
      setSearchError('Search failed. Please try again.');
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    if (searchMode === 'title') {
      handleTitleSearch(q);
    } else {
      handleNaturalSearch(q);
    }
  };

  return (
    <div className="w-full flex flex-col items-center">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center px-4 text-center max-w-2xl mx-auto pt-14 pb-12 sm:pt-20 sm:pb-16">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#141414] border border-[#232323] text-xs font-medium text-[#FF7A2F] mb-8 tracking-wider uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-[#E63946] animate-pulse" />
          <span>No more endless scrolling</span>
        </div>

        <h1 className="font-heading text-4xl sm:text-6xl font-bold tracking-tight text-[#F5F5F5] leading-tight" aria-label="Movie Night Picker">
          Movie Night{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#E63946] to-[#FF7A2F]">
            Picker
          </span>
        </h1>

        <p className="mt-4 text-lg sm:text-xl text-[#8C8C8C] max-w-lg leading-relaxed">
          Tell us your vibe. We'll pick tonight's movie. Personalized 3-choice
          recommendations tailored in under 60 seconds.
        </p>

        {/* Search Section */}
        <div className="mt-8 w-full max-w-xl">
          <div className="mb-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setSearchMode('title')}
              className={`px-4 py-2 rounded-[10px] text-sm font-medium transition-all ${
                searchMode === 'title'
                  ? 'bg-[#FF7A2F] text-white'
                  : 'bg-[#141414] border border-[#232323] text-[#8C8C8C] hover:text-white hover:border-[#353534]'
              }`}
            >
              Exact Title
            </button>
            <button
              onClick={() => setSearchMode('natural')}
              className={`px-4 py-2 rounded-[10px] text-sm font-medium transition-all ${
                searchMode === 'natural'
                  ? 'bg-[#FF7A2F] text-white'
                  : 'bg-[#141414] border border-[#232323] text-[#8C8C8C] hover:text-white hover:border-[#353534]'
              }`}
            >
              Natural Language
            </button>
          </div>
          <form onSubmit={handleSearchSubmit} className="relative">
            <div className="flex items-center gap-2">
              <Search className="absolute left-3 text-[#8C8C8C] w-5 h-5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchMode === 'title' 
                  ? 'e.g. Interstellar, The Dark Knight, Parasite' 
                  : 'e.g. "a space movie like Interstellar but shorter", "feel-good comedy for family"'}
                className="w-full pl-10 pr-4 py-3 rounded-[12px] bg-[#0A0A0A] border border-[#232323] focus:border-[#FF7A2F] text-[#F5F5F5] placeholder-[#8C8C8C] outline-none transition-all duration-200"
                maxLength={120}
                disabled={searchLoading}
              />
              {searchLoading && (
                <span className="absolute right-10 text-[#FF7A2F]">
                  <Sparkles className="w-5 h-5 animate-spin" />
                </span>
              )}
            </div>
            {searchError && (
              <p className="mt-2 text-xs text-[#E63946] text-center">{searchError}</p>
            )}
            {showResults && searchResults.length === 0 && !searchLoading && (
              <p className="mt-2 text-xs text-[#8C8C8C] text-center">No results found. Try a different query.</p>
            )}
          </form>
          {showResults && searchResults.length > 0 && (
            <div className="mt-6 w-full max-h-96 overflow-y-auto">
              <h3 className="text-sm font-medium text-[#8C8C8C] mb-3 text-left">Search Results</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {searchResults.map((movie) => (
                  <div
                    key={movie.id}
                    className="p-3 rounded-[12px] bg-[#141414] border border-[#232323] hover:border-[#383838] transition-colors cursor-pointer group"
                    onClick={() => {
                      // Navigate to results with this movie as context
                      setSearchQuery(movie.title);
                      handleTitleSearch(movie.title);
                    }}
                  >
                    <div className="relative aspect-[2/3] rounded-[8px] overflow-hidden bg-[#232323] mb-2">
                      <img
                        src={movie.posterUrl}
                        alt={movie.title}
                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    </div>
                    <h4 className="font-medium text-white text-sm truncate group-hover:text-[#FF7A2F] transition-colors">{movie.title}</h4>
                    <p className="text-xs text-[#8C8C8C] mt-1">{movie.year} • {movie.genres.slice(0, 2).join(', ')} • {movie.runtime}m • {movie.rating}/10</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onStart}
          className="mt-6 px-8 py-4 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-lg flex items-center gap-3 transition-all duration-200 hover:shadow-[0_0_25px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
        >
          <span>Start Full Quiz</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      {/* Discover: feature cards */}
      <div id="discover" className="w-full max-w-6xl mx-auto px-4 pb-14 scroll-mt-20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="p-6 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#383838] transition-colors"
            >
              <div className="w-10 h-10 rounded-[12px] bg-[#0A0A0A] border border-[#232323] flex items-center justify-center text-[#FF7A2F] mb-4">
                <f.icon size={19} />
              </div>
              <h3 className="font-heading font-semibold text-lg text-[#F5F5F5]">{f.title}</h3>
              <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div id="how-it-works" className="w-full border-t border-[#141414] scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4 py-14">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-[#FF7A2F] text-center">
            How it works
          </p>
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5] text-center mt-2">
            From "what to watch?" to "pressing play"
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
            {HOW_IT_WORKS.map((s) => (
              <div
                key={s.step}
                className="p-6 rounded-[16px] bg-[#101010] border border-[#1f1f1f]"
              >
                <span className="font-heading text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#E63946] to-[#FF7A2F]">
                  {s.step}
                </span>
                <h3 className="font-heading font-semibold text-lg text-[#F5F5F5] mt-2">
                  {s.title}
                </h3>
                <p className="text-sm text-[#8C8C8C] mt-1.5 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
