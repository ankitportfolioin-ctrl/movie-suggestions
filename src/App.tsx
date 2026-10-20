import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bookmark,
  Clapperboard,
  Film,
  Search,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
import { WizardState, Movie, ReferenceMovie } from './types';
import { Wizard } from './components/Wizard';
import { ResultsView } from './components/ResultsView';
import { SavedPicksView } from './components/SavedPicksView';
import { QuickPick } from './components/QuickPick';
// FineTuneDrawer is used internally by QuickPick
import {
  getAnonId,
  requestTasteReset,
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
import { trackEvent } from './analytics';

const INITIAL_STATE: WizardState = {
  step: 0,
  types: ['movie'],
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
  wizard: WizardState & { referenceMovies?: ReferenceMovie[] };
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
    const step = parsed.wizard.step >= 9 && !(parsed.movies || []).length ? 0 : parsed.wizard.step;
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

export default function App() {
  const [wizardState, setWizardState] = useState<WizardState & { referenceMovies?: ReferenceMovie[] }>(() => {
    const loaded = loadQuiz();
    return loaded?.wizard ?? { ...INITIAL_STATE, step: 0 };
  });
  const [movies, setMovies] = useState<Movie[]>(() => loadQuiz()?.movies ?? []);
  const [notices, setNotices] = useState<string[]>(() => loadQuiz()?.notices ?? []);
  const [loadError, setLoadError] = useState(false);
  const [errorDetail, setErrorDetail] = useState('');
  const [seenMovieIds, setSeenMovieIds] = useState<number[]>(() => loadQuiz()?.seen ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const recommendSeqRef = useRef(0);
  const [impressionTokens, setImpressionTokens] = useState<ImpressionToken[]>([]);
  const [dismissedIds, setDismissedIds] = useState<number[]>([]);
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
  const [resetStatus, setResetStatus] = useState('');
  const [touched, setTouched] = useState<number[]>(() => loadQuiz()?.touched ?? []);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardTouched, setWizardTouched] = useState<number[]>([]);

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

  // Reset scroll on view change
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [wizardState.step]);

  // Apply taste decay once per page load.
  useEffect(() => {
    const anon = getAnonId();
    if (anon && anon !== 'none') applyDecay(anon);
  }, []);

  // Update wizard properties
  const handleUpdate = (updates: Partial<WizardState & { referenceMovies?: ReferenceMovie[] }>) => {
    setWizardState((prev) => ({ ...prev, ...updates }));
  };

  const handleWizardNext = () => {
    const step = wizardStep;
    setWizardTouched((t) => (t.includes(step) ? t : [...t, step]));
    setWizardStep((prev) => prev + 1);
  };

  const handleWizardSubmit = () => {
    setWizardTouched((t) => (t.includes(8) ? t : [...t, 8]));
    fetchRecommendationsFromWizard();
  };

  const handleWizardBack = () => {
    setWizardStep((prev) => Math.max(1, prev - 1));
  };

  const handleWizardCancel = () => {
    if (window.confirm('Quit the quiz? Your answers will be cleared.')) {
      setShowWizard(false);
      setWizardStep(1);
      setWizardTouched([]);
      setWizardState(INITIAL_STATE);
    }
  };

  const handleBrandClick = () => {
    const hasProgress = movies.length > 0 || dismissedIds.length > 0 || showWizard;
    if (hasProgress) {
      if (showWizard) {
        handleWizardCancel();
      } else {
        handleReset();
      }
      return;
    }
    setShowSaved(false);
    setWizardState((prev) => ({ ...prev, step: 0 }));
  };

  const handleBackToFilters = () => {
    setShowWizard(true);
    setWizardStep(7);
  };

  const handleReset = () => {
    setWizardState({ ...INITIAL_STATE, step: 0 });
    setMovies([]);
    setNotices([]);
    setLoadError(false);
    setSeenMovieIds([]);
    setTouched([]);
    setImpressionTokens([]);
    setDismissedIds([]);
    setShowWizard(false);
    setWizardStep(1);
    setWizardTouched([]);
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
    if (isSaving) {
      trackEvent('movie_save', { movieId: movie.id });
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
    setSeenMovieIds((prev) => (prev.includes(movie.id) ? prev : [...prev, movie.id]));
    setDismissedIds((prev) => (prev.includes(movie.id) ? prev : [...prev, movie.id]));
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

  const handleResetTaste = async () => {
    const anon = getAnonId();
    const serverOk = anon && anon !== 'none' ? await requestTasteReset(anon) : true;
    resetTaste();
    const fresh = getAnonId();
    if (fresh && fresh !== 'none') setTasteVector(fresh, {});
    try {
      localStorage.removeItem('cinematch:taste:eventCount');
    } catch {
      // Storage unavailable: nothing was stored to remove.
    }
    setTasteEventCount(0);
    setDismissedIds([]);
    setResetStatus(
      serverOk
        ? 'Taste reset: this browser\'s taste profile is cleared and its anonymous server counts are deleted.'
        : 'Taste reset in this browser. The server could not be reached to delete its anonymous counts — try again later.'
    );
  };

  // Fetch recommendations from /api/recommend using current wizardState
  const fetchRecommendations = async (
    customExclude?: number[],
    resetHistory = false,
    genreOverride?: string[]
  ): Promise<number> => {
    const seq = ++recommendSeqRef.current;
    const stale = () => seq !== recommendSeqRef.current;

    setIsLoading(true);
    setLoadError(false);
    setErrorDetail('');
    setShowSaved(false);
    setResetStatus('');
    setWizardState((prev) => ({ ...prev, step: 9 }));

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
        types: wizardState.types || ['movie'],
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
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        throw new Error('Failed to fetch recommendations');
      }

      const data = await res.json();
      if (stale()) return -1;
      trackEvent('recommendation_served', { count: (data.movies || []).length });
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
      return newMovies.length;
    } catch (e) {
      if (!stale()) {
        setMovies([]);
        setNotices([]);
        setImpressionTokens([]);
        setLoadError(true);
        setErrorDetail(
          e instanceof DOMException && e.name === 'TimeoutError'
            ? 'The search took too long and timed out. Try again in a moment.'
            : ''
        );
      }
      return -1;
    } finally {
      if (!stale()) setIsLoading(false);
    }
  };

  // Fetch recommendations using wizard step state
  const fetchRecommendationsFromWizard = async (
    customExclude?: number[],
    resetHistory = false,
    genreOverride?: string[]
  ): Promise<number> => {
    const seq = ++recommendSeqRef.current;
    const stale = () => seq !== recommendSeqRef.current;

    setIsLoading(true);
    setLoadError(false);
    setErrorDetail('');
    setShowSaved(false);
    setResetStatus('');
    setWizardState((prev) => ({ ...prev, step: 9 }));
    setShowWizard(false);

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
        types: wizardState.types || ['movie'],
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
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        throw new Error('Failed to fetch recommendations');
      }

      const data = await res.json();
      if (stale()) return -1;
      trackEvent('recommendation_served', { count: (data.movies || []).length });
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
      return newMovies.length;
    } catch (e) {
      if (!stale()) {
        setMovies([]);
        setNotices([]);
        setImpressionTokens([]);
        setLoadError(true);
        setErrorDetail(
          e instanceof DOMException && e.name === 'TimeoutError'
            ? 'The search took too long and timed out. Try again in a moment.'
            : ''
        );
      }
      return -1;
    } finally {
      if (!stale()) setIsLoading(false);
    }
  };

  const handleMore = async () => {
    const count = await fetchRecommendations();
    if (count >= 0 && count < 3) {
      setNotices((prev) => [
        ...prev,
        count === 0
          ? 'No further picks match these filters right now — adjust filters to widen the pool.'
          : `Only ${count} more pick${count === 1 ? '' : 's'} available with these filters — adjust filters for more options.`,
      ]);
    }
  };

  const MORE_LIKE_GENRES = new Set([
    'Surprise me', 'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
    'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror', 'Mystery',
    'Romance', 'Sci-Fi', 'Thriller',
  ]);

  const handleMoreLike = (movie: Movie) => {
    const tok = tokenFor(movie.id);
    if (tok) void sendFeedbackEvent(tok, 'more_like_this');
    const seeded = movie.genres.filter((g) => MORE_LIKE_GENRES.has(g)).slice(0, 2);
    const nextGenres = seeded.length > 0 ? seeded : ['Surprise me'];
    setWizardState((prev) => ({ ...prev, genres: nextGenres }));
    fetchRecommendations(undefined, false, nextGenres);
  };

  const handleCycle = () => {
    const anon = getAnonId();
    for (const m of movies) {
      const tok = tokenFor(m.id);
      if (tok) void sendFeedbackEvent(tok, 'different_picks');
      if (anon && anon !== 'none') {
        updateTasteFromEvent(anon, m, 'different_picks');
        setTasteEventCount((c) => c + 1);
      }
    }
    const currentIds = movies.map((m) => m.id);
    fetchRecommendations(currentIds, true);
  };

  const handleQuickPickRecommendations = (state: WizardState & { referenceMovies?: ReferenceMovie[] }) => {
    // Update the main wizard state with the quick pick selections
    setWizardState(state);
    fetchRecommendations();
  };

  const handleSearchTitle = (query: string) => {
    setWizardState((prev) => ({ ...prev, step: 9 }));
    // We'll use the existing search flow but navigate to results
    // For now, just do a title search and show results
    // The actual implementation would call the search API
  };

  const handleSearchNatural = (query: string) => {
    setWizardState((prev) => ({ ...prev, step: 9 }));
  };

  const handleOpenFineTune = () => {
    setShowWizard(true);
    setWizardStep(1);
  };

  const handleOpenSaved = () => {
    setShowSaved(true);
  };

  const showHeader = !showSaved && !showWizard && wizardState.step !== 9;

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F5] flex flex-col justify-between selection:bg-[#E63946]/30 selection:text-[#F5F5F5]">
      {/* CineMatch header */}
      {showHeader && (
        <header className="sticky top-0 z-40 bg-[#0A0A0A]/85 backdrop-blur-md border-b border-[#141414]">
          <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between gap-4">
            <button
              onClick={handleBrandClick}
              aria-label="CineMatch home"
              className="flex items-center gap-2 font-heading font-bold text-lg tracking-tight text-[#F5F5F5] hover:text-white transition-colors cursor-pointer"
            >
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#E63946] to-[#FF7A2F] flex items-center justify-center">
                <Clapperboard size={18} className="text-white" />
              </span>
              <span>CineMatch</span>
            </button>

            <nav className="hidden sm:flex items-center gap-7 text-sm text-[#8C8C8C]">
              <button
                onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                className="hover:text-[#F5F5F5] transition-colors cursor-pointer"
              >
                How It Works
              </button>
              <button
                onClick={handleOpenSaved}
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
              <a href="/analytics" className="hover:text-[#F5F5F5] transition-colors">Traffic</a>
            </nav>

            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenSaved}
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
                ? (setShowSaved(false), setWizardState((prev) => ({ ...prev, step: 9 })))
                : handleReset()
            }
            onStartQuiz={() => {
              setShowSaved(false);
              setShowWizard(true);
              setWizardStep(1);
              window.scrollTo({ top: 0 });
            }}
          />
        ) : showWizard ? (
          <Wizard
            state={wizardState}
            onChange={handleUpdate}
            onNext={handleWizardNext}
            onBack={handleWizardBack}
            onCancel={handleWizardCancel}
            onSubmit={handleWizardSubmit}
            isLoading={isLoading}
            touchedSteps={wizardTouched}
          />
        ) : wizardState.step < 9 ? (
          <QuickPick
            onGetRecommendations={handleQuickPickRecommendations}
            onSearchTitle={handleSearchTitle}
            onSearchNatural={handleSearchNatural}
            onOpenSaved={handleOpenSaved}
            savedCount={saved.length}
            isLoading={isLoading}
          />
        ) : (
          <ResultsView
            movies={movies}
            isLoading={isLoading}
            loadError={loadError}
            errorDetail={errorDetail}
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
            resetStatus={resetStatus}
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
          <span>No accounts · Your picks and taste profile stay in this browser · Quiz answers are sent to our server to rank recommendations</span>
        </div>
      </footer>
    </div>
  );
}