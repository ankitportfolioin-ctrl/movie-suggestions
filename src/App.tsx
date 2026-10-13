import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Award,
  Bookmark,
  Clapperboard,
  Smile,
  Tv,
} from 'lucide-react';
import { WizardState, Movie } from './types';
import { Wizard } from './components/Wizard';
import { ResultsView } from './components/ResultsView';
import { SavedPicksView } from './components/SavedPicksView';

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

function loadSaved(): Movie[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.id === 'number') : [];
  } catch {
    return [];
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
  const [wizardState, setWizardState] = useState<WizardState>(INITIAL_STATE);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [seenMovieIds, setSeenMovieIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [saved, setSaved] = useState<Movie[]>(loadSaved);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch {
      // Private mode etc: saved picks simply won't persist.
    }
  }, [saved]);

  // Update wizard properties
  const handleUpdate = (updates: Partial<WizardState>) => {
    setWizardState((prev) => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    setWizardState((prev) => ({ ...prev, step: prev.step + 1 }));
  };

  const handleBack = () => {
    setWizardState((prev) => ({ ...prev, step: Math.max(0, prev.step - 1) }));
  };

  const handleCancel = () => {
    setShowSaved(false);
    setWizardState((prev) => ({ ...prev, step: 0 }));
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
  };

  const toggleSave = (movie: Movie) => {
    setSaved((prev) =>
      prev.some((m) => m.id === movie.id)
        ? prev.filter((m) => m.id !== movie.id)
        : [...prev, movie]
    );
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
      const payload = {
        mood: wizardState.mood,
        genres: genreOverride ?? wizardState.genres,
        audience: wizardState.audience,
        maxRuntime: wizardState.maxRuntime,
        languages: wizardState.languages,
        preferences: wizardState.preferences,
        note: wizardState.note,
        excludeIds: currentExcludes,
      };

      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('Failed to fetch recommendations');
      }

      const data = await res.json();
      const newMovies: Movie[] = Array.isArray(data.movies) ? data.movies : [];
      setNotices(
        Array.isArray(data.notices) ? data.notices.filter((n: unknown) => typeof n === 'string') : []
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
    // Seed a fresh search from this movie's own genres, excluding seen titles.
    const seeded = movie.genres.filter((g) => MORE_LIKE_GENRES.has(g)).slice(0, 2);
    const nextGenres = seeded.length > 0 ? seeded : ['Surprise me'];
    setWizardState((prev) => ({ ...prev, genres: nextGenres }));
    fetchRecommendations(undefined, false, nextGenres);
  };

  const handleCycle = () => {
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
              onSubmit={() => fetchRecommendations([])}
              isLoading={isLoading}
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
            onBackToFilters={handleBackToFilters}
            saved={saved}
            onToggleSave={toggleSave}
            onMoreLike={handleMoreLike}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="w-full shrink-0 border-t border-[#141414]">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Clapperboard size={15} className="text-[#FF7A2F]" />
            <span className="font-heading font-semibold text-[#F5F5F5]">CineMatch</span>
            <span className="text-[#8C8C8C] text-xs">© 2025 CineMatch. Powered by OMDb & Watchmode.</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-[#8C8C8C]">
            <span className="hover:text-[#F5F5F5] transition-colors cursor-pointer">Privacy Policy</span>
            <span className="hover:text-[#F5F5F5] transition-colors cursor-pointer">Terms of Service</span>
            <span className="hover:text-[#F5F5F5] transition-colors cursor-pointer">Feedback</span>
          </div>
        </div>
        <div className="w-full pb-4 text-center text-[11px] text-[#666666]">
          <span>Movie data by OMDb · Streaming data by Watchmode</span>
        </div>
      </footer>
    </div>
  );
}

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <div className="w-full flex flex-col items-center">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center px-4 text-center max-w-2xl mx-auto pt-14 pb-12 sm:pt-20 sm:pb-16">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#141414] border border-[#232323] text-xs font-medium text-[#FF7A2F] mb-8 tracking-wider uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-[#E63946] animate-pulse" />
          <span>No more endless scrolling</span>
        </div>

        <h1 className="font-heading text-4xl sm:text-6xl font-bold tracking-tight text-[#F5F5F5] leading-tight">
          Movie Night{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#E63946] to-[#FF7A2F]">
            Picker
          </span>
        </h1>

        <p className="mt-4 text-lg sm:text-xl text-[#8C8C8C] max-w-lg leading-relaxed">
          Tell us your vibe. We'll pick tonight's movie. Personalized 3-choice
          recommendations tailored in under 60 seconds.
        </p>

        <button
          onClick={onStart}
          className="mt-10 px-8 py-4 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-lg flex items-center gap-3 transition-all duration-200 hover:shadow-[0_0_25px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
        >
          <span>Start Tonight's Match</span>
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
