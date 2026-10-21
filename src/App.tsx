import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowRight,
  Bookmark,
  Clapperboard,
  Film,
  Search,
  Sparkles,
  SlidersHorizontal,
  X,
  RotateCcw,
} from 'lucide-react';
import { WizardState, Movie, ReferenceMovie } from './types';
import { Wizard } from './components/Wizard';
import { ResultsView } from './components/ResultsView';
import { SavedPicksView } from './components/SavedPicksView';
import { HomePage } from './components/HomePage';
import { PickForMe } from './components/PickForMe';
import { NaturalSearch, SearchChip, parseQueryToChips } from './components/NaturalSearch';
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

type ViewMode = 'home' | 'wizard' | 'results' | 'saved' | 'pick-for-me' | 'natural-search';

interface ActiveFilters {
  types: string[];
  moods: string[];
  audiences: string[];
  runtimes: string[];
  providers: string[];
}

interface RecommendRequest {
  mood: string;
  genres: string[];
  audience: string;
  maxRuntime: string;
  languages: string[];
  types: string[];
  preferences: WizardState['preferences'];
  note: string;
  excludeIds: number[];
  anonId: string;
  taste: { weights: Record<string, number>; eventCount: number };
  referenceIds: string[];
}

// UI filter labels -> the lowercase kinds the API understands. Sending the
// label itself ("Series") made the server drop it and fall back to movies.
const TYPE_LABEL_TO_API: Record<string, string[]> = {
  Movie: ['movie'],
  Series: ['series'],
  'Short film': ['short'],
  Any: ['movie', 'short', 'series'],
};
function typeLabelsToApi(labels: string[]): string[] {
  const out = new Set<string>();
  for (const label of labels) {
    const mapped = TYPE_LABEL_TO_API[label] ?? (['movie', 'short', 'series'].includes(label.toLowerCase()) ? [label.toLowerCase()] : []);
    mapped.forEach((t) => out.add(t));
  }
  return out.size > 0 ? [...out] : ['movie'];
}

// Values /api/recommend accepts; anything else would be rejected with a 400.
const NS_MOODS = new Set(['Mind-bending', 'Suspenseful', 'Funny', 'Feel-good', 'Emotional', 'Adventurous', 'Romantic', 'Surprise me']);
const NS_GENRES = new Set(['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller']);
const NS_AUDIENCES = new Set(['Just me', 'Partner', 'Friends', 'Family with kids', 'Family / kids']);
const NS_RUNTIMES = new Set(['Under 90 min', '90–120 min', 'Over 2 hours', 'Under 2 hours', 'Under 2.5 hours']);

// Resolve a typed title ("the matrix") to a real IMDb id through the title
// search endpoint. The recommend API only accepts real tt-ids as references.
const normTitle = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
async function resolveReferenceTitle(title: string, exactOnly = false): Promise<ReferenceMovie | null> {
  try {
    const res = await fetch(`/api/title-search?q=${encodeURIComponent(title)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = Array.isArray(data?.results)
      ? data.results.find((r: any) => /^tt\d+$/.test(r?.imdbId ?? '') && (!exactOnly || normTitle(r.title ?? '') === normTitle(title)))
      : null;
    return hit ? { imdbId: hit.imdbId, title: hit.title, year: hit.year ?? new Date().getFullYear() } : null;
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

  // New flow state - single source of truth for step
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [showWizard, setShowWizard] = useState(false);
  const [showPickForMe, setShowPickForMe] = useState(false);
  const [showNaturalSearch, setShowNaturalSearch] = useState(false);
  const [naturalSearchQuery, setNaturalSearchQuery] = useState('');
  const [naturalSearchChips, setNaturalSearchChips] = useState<SearchChip[]>([]);
  const [recommendationStartTime, setRecommendationStartTime] = useState<number | null>(null);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({
    types: [],
    moods: [],
    audiences: [],
    runtimes: [],
    providers: [],
  });

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
  }, [viewMode, wizardState.step]);

  // Apply taste decay once per page load.
  useEffect(() => {
    const anon = getAnonId();
    if (anon && anon !== 'none') applyDecay(anon);
  }, []);

  // Update wizard properties
  const handleUpdate = useCallback((updates: Partial<WizardState & { referenceMovies?: ReferenceMovie[] }>) => {
    setWizardState((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleWizardNext = useCallback(() => {
    setWizardState((prev) => {
      const nextStep = Math.min(prev.step + 1, 8);
      return { ...prev, step: nextStep };
    });
  }, []);

  const handleWizardBack = useCallback(() => {
    setWizardState((prev) => ({ ...prev, step: Math.max(1, prev.step - 1) }));
  }, []);

  const handleWizardCancel = useCallback(() => {
    if (window.confirm('Quit the quiz? Your answers will be cleared.')) {
      setShowWizard(false);
      setWizardState({ ...INITIAL_STATE, step: 0 });
      setViewMode('home');
    }
  }, []);

  const handleWizardSubmit = useCallback(() => {
    setWizardState((prev) => ({ ...prev, step: 9 }));
    fetchRecommendations(buildRecommendRequest(wizardState));
    setShowWizard(false);
    setViewMode('results');
  }, []);

  const handleBrandClick = useCallback(() => {
    const hasProgress = movies.length > 0 || dismissedIds.length > 0 || showWizard || showPickForMe || showNaturalSearch;
    if (hasProgress) {
      if (showWizard) {
        handleWizardCancel();
      } else if (showPickForMe) {
        setShowPickForMe(false);
      } else if (showNaturalSearch) {
        setShowNaturalSearch(false);
        setNaturalSearchQuery('');
        setNaturalSearchChips([]);
      } else {
        handleReset();
      }
      return;
    }
    setShowSaved(false);
    setViewMode('home');
    setWizardState((prev) => ({ ...prev, step: 0 }));
  }, [movies.length, dismissedIds.length, showWizard, showPickForMe, showNaturalSearch, handleWizardCancel]);

  const handleReset = useCallback(() => {
    setWizardState({ ...INITIAL_STATE, step: 0 });
    setMovies([]);
    setNotices([]);
    setLoadError(false);
    setSeenMovieIds([]);
    setTouched([]);
    setImpressionTokens([]);
    setDismissedIds([]);
    setShowWizard(false);
    setShowPickForMe(false);
    setShowNaturalSearch(false);
    setNaturalSearchQuery('');
    setNaturalSearchChips([]);
    setActiveFilters({ types: [], moods: [], audiences: [], runtimes: [], providers: [] });
    setViewMode('home');
  }, []);

  const tokenFor = useCallback((movieId: number): ImpressionToken | undefined =>
    impressionTokens.find((t) => t.movieId === movieId), [impressionTokens]);

  const toggleSave = useCallback((movie: Movie) => {
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
  }, [saved, tokenFor, tasteEventCount]);

  const dismissMovie = useCallback((movie: Movie, action: 'seen_it' | 'not_for_me' | 'less_like_this') => {
    const tok = tokenFor(movie.id);
    if (tok) void sendFeedbackEvent(tok, action);
    setSeenMovieIds((prev) => (prev.includes(movie.id) ? prev : [...prev, movie.id]));
    setDismissedIds((prev) => (prev.includes(movie.id) ? prev : [...prev, movie.id]));
    if (action === 'not_for_me' || action === 'less_like_this') {
      const anon = getAnonId();
      if (anon && anon !== 'none') {
        updateTasteFromEvent(anon, movie, action);
        setTasteEventCount((c) => c + 1);
      }
    }
  }, [tokenFor, tasteEventCount]);

  const handleNotForMe = useCallback((movie: Movie) => dismissMovie(movie, 'not_for_me'), [dismissMovie]);
  const handleSeenIt = useCallback((movie: Movie) => dismissMovie(movie, 'seen_it'), [dismissMovie]);
  const handleLessLike = useCallback((movie: Movie) => dismissMovie(movie, 'less_like_this'), [dismissMovie]);

  const handleWatchOptions = useCallback((movie: Movie) => {
    const tok = tokenFor(movie.id);
    if (tok) void sendFeedbackEvent(tok, 'provider_click');
  }, [tokenFor]);

  const handleResetTaste = useCallback(async () => {
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
  }, []);

  // Build recommendation request from explicit state (not closure)
  const buildRecommendRequest = useCallback((state: WizardState & { referenceMovies?: ReferenceMovie[] }): RecommendRequest => {
    const anon = getAnonId();
    const tastePayload = getTastePayload(anon, tasteEventCount);
    const referenceIds = (state.referenceMovies || []).map((r) => r.imdbId);
    return {
      mood: state.mood,
      genres: state.genres,
      audience: state.audience,
      maxRuntime: state.maxRuntime,
      languages: state.languages,
      types: state.types || ['movie'],
      preferences: state.preferences,
      note: state.note,
      excludeIds: seenMovieIds,
      anonId: anon,
      taste: tastePayload,
      referenceIds,
    };
  }, [seenMovieIds, tasteEventCount]);

  // Single fetch function that takes explicit request state
  const fetchRecommendations = useCallback(async (request: RecommendRequest): Promise<number> => {
    const seq = ++recommendSeqRef.current;
    const stale = () => seq !== recommendSeqRef.current;

    setIsLoading(true);
    setLoadError(false);
    setErrorDetail('');
    setShowSaved(false);
    setResetStatus('');
    setRecommendationStartTime(Date.now());

    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(45000),
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
        Array.from(new Set([...prev, ...newIds]))
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
  }, []);

  // Append new recommendations while preserving existing movies and deduplicating
  const fetchRecommendationsAppend = useCallback(async (request: RecommendRequest): Promise<number> => {
    const seq = ++recommendSeqRef.current;
    const stale = () => seq !== recommendSeqRef.current;

    setIsLoading(true);
    setLoadError(false);
    setErrorDetail('');

    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(45000),
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

      // Append new movies, deduplicate by ID
      setMovies((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const uniqueNew = newMovies.filter((m) => !existingIds.has(m.id));
        return [...prev, ...uniqueNew];
      });
      const newIds = newMovies.map((m) => m.id);
      setSeenMovieIds((prev) =>
        Array.from(new Set([...prev, ...newIds]))
      );
      return newMovies.length;
    } catch (e) {
      if (!stale()) {
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
  }, []);

  const handleMore = useCallback(async () => {
    const request = buildRecommendRequest(wizardState);
    const newMovies = await fetchRecommendationsAppend({ ...request, excludeIds: seenMovieIds });
    if (newMovies >= 0 && newMovies < 3) {
      setNotices((prev) => [
        ...prev,
        newMovies === 0
          ? 'No further picks match these filters right now — adjust filters to widen the pool.'
          : `Only ${newMovies} more pick${newMovies === 1 ? '' : 's'} available with these filters — adjust filters for more options.`,
      ]);
    }
  }, [buildRecommendRequest, fetchRecommendationsAppend, seenMovieIds]);

  const MORE_LIKE_GENRES = new Set([
    'Surprise me', 'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
    'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror', 'Mystery',
    'Romance', 'Sci-Fi', 'Thriller',
  ]);

  const handleMoreLike = useCallback((movie: Movie) => {
    const tok = tokenFor(movie.id);
    if (tok) void sendFeedbackEvent(tok, 'more_like_this');
    const seeded = movie.genres.filter((g) => MORE_LIKE_GENRES.has(g)).slice(0, 2);
    const nextGenres = seeded.length > 0 ? seeded : ['Surprise me'];
    setWizardState((prev) => ({ ...prev, genres: nextGenres }));
    const request = buildRecommendRequest({ ...wizardState, genres: nextGenres });
    fetchRecommendations(request);
  }, [tokenFor, wizardState, buildRecommendRequest, fetchRecommendations]);

  const handleCycle = useCallback(() => {
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
    const request = buildRecommendRequest(wizardState);
    fetchRecommendations({ ...request, excludeIds: currentIds });
  }, [movies, tokenFor, wizardState, buildRecommendRequest, fetchRecommendations]);

  // HomePage callbacks
  const handlePickForMe = useCallback(() => {
    setShowPickForMe(true);
    setViewMode('pick-for-me');
  }, []);

  const handleBrowseMood = useCallback((moodId?: string) => {
    if (moodId) {
      const moodMap: Record<string, string> = {
        'mind-bending': 'Mind-bending',
        'suspenseful': 'Suspenseful',
        'funny': 'Funny',
        'feel-good': 'Feel-good',
        'emotional': 'Emotional',
        'adventurous': 'Adventurous',
        'surprise': 'Surprise me',
      };
      setWizardState((prev) => ({ ...prev, mood: moodMap[moodId] || 'Surprise me', genres: ['Surprise me'] }));
      const request = buildRecommendRequest(wizardState);
      fetchRecommendations(request);
      setViewMode('results');
    } else {
      // Show mood collections - handled by HomePage
    }
  }, [wizardState, buildRecommendRequest, fetchRecommendations]);

  const handlePopularNow = useCallback(() => {
    setWizardState((prev) => ({ ...prev, mood: 'Surprise me', genres: ['Surprise me'], preferences: { ...prev.preferences, recent: true } }));
    const request = buildRecommendRequest(wizardState);
    fetchRecommendations(request);
    setViewMode('results');
  }, [wizardState, buildRecommendRequest, fetchRecommendations]);

  const handleMoviesSeries = useCallback(() => {
    setShowWizard(true);
    setWizardState((prev) => ({ ...prev, step: 1 }));
    setViewMode('wizard');
  }, []);

  const handleCollectionClick = useCallback((collection: string) => {
    const currentYear = new Date().getFullYear();
    let newState: Partial<WizardState & { referenceMovies?: ReferenceMovie[] }> = {};
    
    if (collection.includes('Best of')) {
      const year = currentYear;
      newState = { 
        mood: 'Surprise me', 
        genres: ['Surprise me'], 
        preferences: { ...wizardState.preferences, recent: true }, 
        note: `Best of ${year}`,
        collectionIntent: { type: 'best-of-year', year } as any,
      };
    } else if (collection === 'New this week') {
      newState = { 
        mood: 'Surprise me', 
        genres: ['Surprise me'], 
        preferences: { ...wizardState.preferences, recent: true }, 
        note: 'New this week',
        collectionIntent: { type: 'new-this-week' } as any,
      };
    } else if (collection === 'Hidden gems') {
      newState = { 
        mood: 'Surprise me', 
        genres: ['Surprise me'], 
        preferences: { ...wizardState.preferences, hiddenGems: true },
        collectionIntent: { type: 'hidden-gems' } as any,
      };
    } else if (collection === 'Family night') {
      newState = { 
        mood: 'Feel-good', 
        genres: ['Family', 'Comedy', 'Animation'], 
        audience: 'Family with kids', 
        preferences: { ...wizardState.preferences, mature: false },
        collectionIntent: { type: 'family-night' } as any,
      };
    }
    
    setWizardState((prev) => ({ ...prev, ...newState }));
    const newWizardState = { ...wizardState, ...newState };
    const request = buildRecommendRequest(newWizardState);
    fetchRecommendations(request);
    setViewMode('results');
  }, [wizardState, buildRecommendRequest, fetchRecommendations]);

  const handlePickForMeSubmit = useCallback((state: WizardState & { referenceMovies?: ReferenceMovie[] }) => {
    setWizardState(state);
    setShowPickForMe(false);
    const request = buildRecommendRequest(state);
    fetchRecommendations(request);
    setViewMode('results');
  }, [buildRecommendRequest, fetchRecommendations]);

  const handleNaturalSearch = useCallback(async (query: string, chips: SearchChip[]) => {
    setNaturalSearchQuery(query);
    setNaturalSearchChips(chips);
    setShowNaturalSearch(false);
    setViewMode('results');

    // Translate chips into API-valid wizard values.
    const genres = chips.filter((c) => c.type === 'genre').map((c) => c.label).filter((g) => NS_GENRES.has(g));
    const mood = chips.filter((c) => c.type === 'mood').map((c) => c.label).find((m) => NS_MOODS.has(m));
    const audience = chips.filter((c) => c.type === 'audience').map((c) => c.label).find((a) => NS_AUDIENCES.has(a));
    const runtime = chips.filter((c) => c.type === 'runtime').map((c) => c.label).find((r) => NS_RUNTIMES.has(r));
    const refTitles = chips
      .filter((c) => c.type === 'reference')
      .map((c) => c.label.replace(/^like "/, '').replace(/"$/, ''))
      .filter(Boolean)
      .slice(0, 3);

    // Show the loading state while reference titles resolve (a couple of
    // hundred ms), then search with the REAL state - never the stale closure.
    setIsLoading(true);
    const resolved = (await Promise.all(refTitles.map((t) => resolveReferenceTitle(t)))).filter(
      (r): r is ReferenceMovie => r !== null,
    );
    // A bare title ("Inception") yields no chips: if it exactly matches a
    // catalog title, treat it as "movies like that title".
    if (resolved.length === 0 && chips.length === 0 && query.split(/\s+/).length <= 6) {
      const exact = await resolveReferenceTitle(query, true);
      if (exact) resolved.push(exact);
    }

    const next = {
      ...wizardState,
      mood: mood ?? 'Surprise me',
      genres: genres.length > 0 ? genres : ['Surprise me'],
      // The server's family-safety rules key off the exact value 'Family with kids'.
      audience: !audience ? 'Just me' : audience === 'Family / kids' ? 'Family with kids' : audience,
      maxRuntime: runtime ?? 'Any length',
      note: query,
      referenceMovies: resolved,
    };
    setWizardState(next);
    fetchRecommendations(buildRecommendRequest(next));
  }, [wizardState, buildRecommendRequest, fetchRecommendations]);

  const handleSearchSubmit = useCallback((query: string, mode: 'title' | 'natural') => {
    if (mode === 'title') {
      // Title search: carry the typed text as the note and search right away.
      const next = { ...wizardState, note: query };
      setWizardState(next);
      fetchRecommendations(buildRecommendRequest(next));
      setViewMode('results');
    } else if (query.trim().length >= 3) {
      // Natural language: interpret the text and search on the FIRST Enter.
      void handleNaturalSearch(query.trim(), parseQueryToChips(query.trim()));
    } else {
      // Too short to search: open the dedicated page so the user can keep typing.
      setNaturalSearchQuery(query);
      setShowNaturalSearch(true);
      setViewMode('natural-search');
    }
  }, [wizardState, buildRecommendRequest, fetchRecommendations, handleNaturalSearch]);

  const handleFilterChange = useCallback((filters: Partial<ActiveFilters>) => {
    setActiveFilters(prev => ({ ...prev, ...filters }));
    // Translate to wizard state and refetch
    const newWizardState = { ...wizardState };
    if (filters.types) newWizardState.types = typeLabelsToApi(filters.types);
    if (filters.moods) newWizardState.mood = filters.moods[0] ?? 'Surprise me';
    if (filters.audiences) newWizardState.audience = filters.audiences[0] ?? 'Just me';
    if (filters.runtimes) newWizardState.maxRuntime = filters.runtimes[0] ?? 'Any length';
    setWizardState(newWizardState);
    const request = buildRecommendRequest(newWizardState);
    fetchRecommendations(request);
  }, [wizardState, buildRecommendRequest, fetchRecommendations]);

  const buildActiveFilterChips = useCallback(() => {
    const chips: Array<{key: string, label: string, value: string}> = [];
    if (activeFilters.types.length) chips.push(...activeFilters.types.map(v => ({ key: 'types', label: 'Type', value: v })));
    if (activeFilters.moods.length) chips.push(...activeFilters.moods.map(v => ({ key: 'moods', label: 'Mood', value: v })));
    if (activeFilters.audiences.length) chips.push(...activeFilters.audiences.map(v => ({ key: 'audiences', label: 'Audience', value: v })));
    if (activeFilters.runtimes.length) chips.push(...activeFilters.runtimes.map(v => ({ key: 'runtimes', label: 'Runtime', value: v })));
    if (activeFilters.providers.length) chips.push(...activeFilters.providers.map(v => ({ key: 'providers', label: 'Provider', value: v })));
    // Also include wizard state as active filters
    if (wizardState.mood && wizardState.mood !== 'Surprise me') chips.push({ key: 'moods', label: 'Mood', value: wizardState.mood });
    if (wizardState.audience && wizardState.audience !== 'Just me') chips.push({ key: 'audiences', label: 'Audience', value: wizardState.audience });
    if (wizardState.maxRuntime && wizardState.maxRuntime !== 'Any length') chips.push({ key: 'runtimes', label: 'Runtime', value: wizardState.maxRuntime });
    if (wizardState.genres.length && !wizardState.genres.includes('Surprise me')) {
      wizardState.genres.forEach(g => chips.push({ key: 'genres', label: 'Genre', value: g }));
    }
    return chips;
  }, [activeFilters, wizardState]);

  const filterOptions = {
    types: ['Movie', 'Series', 'Short film', 'Any'],
    moods: ['Mind-bending', 'Suspenseful', 'Funny', 'Feel-good', 'Emotional', 'Adventurous', 'Surprise me'],
    audiences: ['Just me', 'Partner', 'Friends', 'Family with kids'],
    runtimes: ['Under 90 min', 'Under 2 hours', 'Under 2.5 hours', 'Miniseries (1 season)', 'Any length'],
  };

  const handleOpenSaved = useCallback(() => {
    setShowSaved(true);
  }, []);

  const showHeader = !showSaved && !showWizard && viewMode !== 'results' && !showPickForMe && !showNaturalSearch;

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
                ? (setShowSaved(false), setViewMode('results'))
                : handleReset()
            }
            onStartQuiz={() => {
              setShowSaved(false);
              setShowWizard(true);
              setWizardState((prev) => ({ ...prev, step: 1 }));
              setViewMode('wizard');
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
            touchedSteps={[]}
          />
        ) : showPickForMe ? (
          <PickForMe
            onSubmit={handlePickForMeSubmit}
            onCancel={() => { setShowPickForMe(false); setViewMode('home'); }}
            isLoading={isLoading}
          />
        ) : showNaturalSearch ? (
          <NaturalSearch
            onSearch={handleNaturalSearch}
            onClose={() => { setShowNaturalSearch(false); setViewMode('home'); }}
            isLoading={isLoading}
            initialQuery={naturalSearchQuery}
            initialChips={naturalSearchChips}
          />
        ) : viewMode === 'results' ? (
          <ResultsView
            movies={movies}
            isLoading={isLoading}
            loadError={loadError}
            errorDetail={errorDetail}
            notices={notices}
            onMore={handleMore}
            onCycle={handleCycle}
            onReset={handleReset}
            onRetry={() => fetchRecommendations(buildRecommendRequest(wizardState))}
            onBackToFilters={() => { setShowWizard(true); setWizardState((prev) => ({ ...prev, step: 7 })); setViewMode('wizard'); }}
            saved={saved}
            dismissedIds={dismissedIds}
            onToggleSave={toggleSave}
            onMoreLike={handleMoreLike}
            onLessLike={handleLessLike}
            onNotForMe={handleNotForMe}
            onSeenIt={handleSeenIt}
            onWatchOptions={handleWatchOptions}
            onResetTaste={handleResetTaste}
            resetStatus={resetStatus}
            activeFilters={buildActiveFilterChips()}
            filterOptions={filterOptions}
            onFilterChange={handleFilterChange}
          />
        ) : (
          <HomePage
            onPickForMe={handlePickForMe}
            onBrowseMood={handleBrowseMood}
            onPopularNow={handlePopularNow}
            onMoviesSeries={handleMoviesSeries}
            onCollectionClick={handleCollectionClick}
            onSearchSubmit={handleSearchSubmit}
            isLoading={isLoading}
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
          <span>No accounts · Your picks and taste profile stay in this browser · Searches and feedback are sent to our server to rank picks</span>
        </div>
      </footer>
    </div>
  );
}