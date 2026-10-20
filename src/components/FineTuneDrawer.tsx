import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronDown, Check, Clock, Globe, Users, Film, Star, Award, Zap, Brain, Heart } from 'lucide-react';
import { WizardState, Preferences, ReferenceMovie } from '../types';

interface FineTuneDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  wizardState: WizardState & { referenceMovies?: ReferenceMovie[] };
  onChange: (updates: Partial<WizardState & { referenceMovies?: ReferenceMovie[] }>) => void;
  disabled?: boolean;
}

const MEDIA_TYPE_OPTIONS = [
  { label: 'Movie', desc: 'Feature film, 41 minutes and up', types: ['movie'] },
  { label: 'Short film', desc: 'A quick watch, 40 minutes or less', types: ['short'] },
  { label: 'Series', desc: 'Episodic TV or web series', types: ['series'] },
  { label: 'Any', desc: 'Movies, shorts and series', types: ['movie', 'short', 'series'] },
];

const GENRES = [
  'Surprise me',
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'Horror',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Thriller',
];

const AUDIENCES = [
  { label: 'Just me', desc: 'Full personal indulgence, no compromises.', icon: Users },
  { label: 'Partner', desc: 'Engaging chemistry, shared interest sweet-spot.', icon: Heart },
  { label: 'Friends', desc: 'Crowd-pleasing dialogue and lively momentum.', icon: Users },
  { label: 'Family with kids', desc: 'Kid-friendly, safe themes, all-ages charm.', icon: Users },
];

const RUNTIMES = [
  { label: 'Under 90 min', desc: 'Brisk & punchy' },
  { label: 'Under 2 hours', desc: 'Standard cinematic duration' },
  { label: 'Under 2.5 hours', desc: 'Epic narratives with room to breathe' },
  { label: 'Any length', desc: 'No time constraints tonight' },
];

const MINISERIES_RUNTIME = { label: 'Miniseries (1 season)', desc: 'A one-season story, no long commitment' };

const LANGUAGES = [
  'Any',
  'English',
  'Hindi',
  'Tamil',
  'Telugu',
  'Korean',
  'Japanese',
  'Spanish',
  'French',
];

const PREFERENCE_TOGGLES = [
  {
    id: 'highlyRated' as const,
    label: 'Highly rated only (7+)',
    desc: 'Focus strictly on critically praised films rated 7.0 and above.',
  },
  {
    id: 'hiddenGems' as const,
    label: 'Hidden gems',
    desc: 'Surface overlooked masterpieces over blockbusters.',
  },
  {
    id: 'recent' as const,
    label: 'Recent (last 5 years)',
    desc: 'Released from 2020 onwards with modern production design.',
  },
  {
    id: 'classics' as const,
    label: 'Classics (before 2000)',
    desc: 'Golden age and legendary cinema history.',
  },
  {
    id: 'mature' as const,
    label: 'Include mature content',
    desc: 'Allow R-rated and dark psychological cinema (defaults OFF).',
  },
];

const FINE_TUNE_TONES = ['Light & fun', 'Thoughtful', 'Intense', 'Dark', 'Uplifting'] as const;
const FINE_TUNE_PACE = ['Slow-burn', 'Medium', 'Fast'] as const;
const FINE_TUNE_INTENSITY = ['No violence', 'Mild', 'Moderate', 'Any'] as const;
const FINE_TUNE_HUMOR = ['Slapstick', 'Witty', 'Dark comedy', 'Satirical'] as const;

export const FineTuneDrawer: React.FC<FineTuneDrawerProps> = ({
  isOpen,
  onClose,
  wizardState,
  onChange,
  disabled = false,
}) => {
  const { genres, audience, maxRuntime, languages, preferences, note, types } = wizardState;
  const currentTypes = types || ['movie'];
  const typeLabel = MEDIA_TYPE_OPTIONS.find((o) => o.types.join(',') === currentTypes.join(','))?.label || 'Movie';
  const runtimeOptions = currentTypes.includes('series') ? [...RUNTIMES, MINISERIES_RUNTIME] : RUNTIMES;
  const referenceMovies = wizardState.referenceMovies || [];

  // Reference movie search state
  const [referenceSearchQuery, setReferenceSearchQuery] = useState('');
  const [referenceSuggestions, setReferenceSuggestions] = useState<Array<{ imdbId: string; title: string; year: number; posterUrl: string }>>([]);
  const [referenceSearchLoading, setReferenceSearchLoading] = useState(false);
  const [referenceSearchError, setReferenceSearchError] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsContainerRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['media', 'genres', 'audience', 'runtime', 'language']));

  const searchReferenceMovies = async (query: string) => {
    if (query.trim().length < 2) {
      setReferenceSuggestions([]);
      return;
    }
    setReferenceSearchLoading(true);
    setReferenceSearchError('');
    try {
      const res = await fetch(`/api/title-search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      if (data.results) {
        setReferenceSuggestions(data.results.slice(0, 5));
      }
    } catch {
      setReferenceSearchError('Could not search titles. Please try again.');
      setReferenceSuggestions([]);
    } finally {
      setReferenceSearchLoading(false);
    }
  };

  const handleReferenceSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setReferenceSearchQuery(value);
    if (value.trim().length === 1) {
      setReferenceSearchError('Keep typing — at least 2 letters to search titles.');
    } else if (referenceSearchError) {
      setReferenceSearchError('');
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => searchReferenceMovies(value), 300);
  };

  const addReferenceMovie = (movie: { imdbId: string; title: string; year: number; posterUrl: string }) => {
    if (referenceMovies.length >= 3) return;
    if (referenceMovies.some((r) => r.imdbId === movie.imdbId)) return;
    onChange({ referenceMovies: [...referenceMovies, { imdbId: movie.imdbId, title: movie.title, year: movie.year }] });
    setReferenceSearchQuery('');
    setReferenceSuggestions([]);
    if (inputRef.current) inputRef.current.blur();
  };

  const removeReferenceMovie = (imdbId: string) => {
    onChange({ referenceMovies: referenceMovies.filter((r) => r.imdbId !== imdbId) });
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(event.target as Node) &&
          suggestionsContainerRef.current && !suggestionsContainerRef.current.contains(event.target as Node)) {
        setReferenceSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const toggleSection = (section: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const handleGenreToggle = (g: string) => {
    if (g === 'Surprise me') {
      onChange({ genres: ['Surprise me'] });
      return;
    }
    const filtered = genres.filter((x) => x !== 'Surprise me');
    if (filtered.includes(g)) {
      onChange({ genres: filtered.filter((x) => x !== g) });
    } else if (filtered.length < 3) {
      onChange({ genres: [...filtered, g] });
    }
  };

  const handleTypeSelect = (option: typeof MEDIA_TYPE_OPTIONS[number]) => {
    const updates: Partial<WizardState> = { types: option.types };
    if (maxRuntime === MINISERIES_RUNTIME.label && !option.types.includes('series')) {
      updates.maxRuntime = 'Any length';
    }
    onChange(updates);
  };

  const genreCounter = genres.includes('Surprise me')
    ? 'Surprise me selected'
    : `${genres.filter((g) => g !== 'Surprise me').length}/3 selected`;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl md:max-w-2xl animate-slide-in" role="dialog" aria-modal="true" aria-labelledby="fine-tune-title">
        <div className="h-full flex flex-col bg-[#0A0A0A] border-l border-[#232323]">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[#232323] sticky top-0 bg-[#0A0A0A]/95 backdrop-blur-sm z-10">
            <h2 id="fine-tune-title" className="font-heading text-xl font-bold text-[#F5F5F5]">Fine-tune preferences</h2>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-[#141414] border border-[#232323] hover:border-[#383838] text-[#8C8C8C] hover:text-[#F5F5F5] flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Close fine-tune"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Clear all button */}
            <button
              type="button"
              onClick={() => onChange({ ...INITIAL_WIZARD_STATE })}
              disabled={disabled}
              className="text-sm text-[#8C8C8C] hover:text-[#FF7A2F] transition-colors cursor-pointer disabled:opacity-50 self-start px-2 py-1"
            >
              Clear all filters
            </button>

            {/* Media Type */}
            <details className="group" open={openSections.has('media')}>
              <summary onClick={(e) => { e.preventDefault(); toggleSection('media'); }} className="flex items-center justify-between p-3 rounded-[12px] bg-[#141414] border border-[#232323] cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <Film size={18} className="text-[#FF7A2F]" />
                  <span className="font-heading font-semibold text-white">Format</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#232323] text-xs text-[#8C8C8C] font-mono">Optional</span>
                </div>
                <ChevronDown className="w-5 h-5 text-[#8C8C8C] group-[&[open]]:rotate-180 transition-transform" />
              </summary>
              <div className="grid grid-cols-2 gap-3 pt-2 animate-slide-down">
                {MEDIA_TYPE_OPTIONS.map((item) => {
                  const isSelected = item.types.join(',') === currentTypes.join(',');
                  return (
                    <button
                      key={item.label}
                      onClick={() => !disabled && handleTypeSelect(item)}
                      disabled={disabled}
                      aria-pressed={isSelected}
                      className={`p-3 rounded-[12px] border text-left transition-all duration-200 cursor-pointer ${isSelected ? 'bg-[#1c1b1b] border-[#FF7A2F] shadow-[0_0_15px_rgba(255,122,47,0.2)] text-white' : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white disabled:opacity-50'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-heading font-semibold text-white">{item.label}</span>
                        {isSelected && <span className="w-2 h-2 rounded-full bg-[#FF7A2F]" />}
                      </div>
                      <div className="text-[11px] leading-tight text-[#8C8C8C]">{item.desc}</div>
                    </button>
                  );
                })}
              </div>
            </details>

            {/* Genres */}
            <details className="group" open={openSections.has('genres')}>
              <summary onClick={(e) => { e.preventDefault(); toggleSection('genres'); }} className="flex items-center justify-between p-3 rounded-[12px] bg-[#141414] border border-[#232323] cursor-pointer list-none">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Award size={18} className="text-[#FF7A2F]" />
                    <span className="font-heading font-semibold text-white">Genres</span>
                    <span className="px-2 py-0.5 rounded-full bg-[#232323] text-xs text-[#8C8C8C] font-mono">Optional</span>
                  </div>
                  <span className="text-xs text-[#8C8C8C] shrink-0">Max 3</span>
                </div>
                <ChevronDown className="w-5 h-5 text-[#8C8C8C] group-[&[open]]:rotate-180 transition-transform" />
              </summary>
              <div className="space-y-3 pt-2 animate-slide-down">
                <p className="text-sm text-[#8C8C8C]">Choose up to 3 genres, or select surprise me.</p>
                <div className="flex flex-wrap gap-2.5">
                  {GENRES.map((g) => {
                    const isSelected = genres.includes(g);
                    return (
                      <button
                        key={g}
                        onClick={() => !disabled && handleGenreToggle(g)}
                        disabled={disabled}
                        aria-pressed={isSelected}
                        className={`px-4 py-2.5 rounded-[12px] border text-sm font-medium transition-all duration-200 cursor-pointer flex items-center gap-2 ${isSelected ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_12px_rgba(255,122,47,0.18)]' : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white disabled:opacity-50'}`}
                      >
                        <span>{g}</span>
                        {isSelected && <Check size={13} className="text-[#FF7A2F]" />}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-[#8C8C8C] font-mono">{genreCounter}</p>
              </div>
            </details>

            {/* Audience */}
            <details className="group" open={openSections.has('audience')}>
              <summary onClick={(e) => { e.preventDefault(); toggleSection('audience'); }} className="flex items-center justify-between p-3 rounded-[12px] bg-[#141414] border border-[#232323] cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <Users size={18} className="text-[#FF7A2F]" />
                  <span className="font-heading font-semibold text-white">Who's watching</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#232323] text-xs text-[#8C8C8C] font-mono">Optional</span>
                </div>
                <ChevronDown className="w-5 h-5 text-[#8C8C8C] group-[&[open]]:rotate-180 transition-transform" />
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 animate-slide-down">
                {AUDIENCES.map((item) => {
                  const isSelected = audience === item.label;
                  return (
                    <button
                      key={item.label}
                      onClick={() => !disabled && onChange({ audience: item.label })}
                      disabled={disabled}
                      aria-pressed={isSelected}
                      className={`p-4 rounded-[12px] border text-left transition-all duration-200 cursor-pointer flex items-start gap-3.5 ${isSelected ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_15px_rgba(255,122,47,0.2)]' : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white disabled:opacity-50'}`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? 'bg-[#FF7A2F]/10 text-[#FF7A2F]' : 'bg-[#0A0A0A] text-[#8C8C8C]'}`}>
                        <item.icon size={20} />
                      </div>
                      <div>
                        <div className="font-heading font-semibold text-white mb-0.5">{item.label}</div>
                        <div className="text-sm text-[#8C8C8C]">{item.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </details>

            {/* Runtime */}
            <details className="group" open={openSections.has('runtime')}>
              <summary onClick={(e) => { e.preventDefault(); toggleSection('runtime'); }} className="flex items-center justify-between p-3 rounded-[12px] bg-[#141414] border border-[#232323] cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <Clock size={18} className="text-[#FF7A2F]" />
                  <span className="font-heading font-semibold text-white">Runtime</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#232323] text-xs text-[#8C8C8C] font-mono">Optional</span>
                </div>
                <ChevronDown className="w-5 h-5 text-[#8C8C8C] group-[&[open]]:rotate-180 transition-transform" />
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 animate-slide-down">
                {runtimeOptions.map((item) => {
                  const isSelected = maxRuntime === item.label;
                  return (
                    <button
                      key={item.label}
                      onClick={() => !disabled && onChange({ maxRuntime: item.label })}
                      disabled={disabled}
                      aria-pressed={isSelected}
                      className={`p-4 rounded-[12px] border text-left transition-all duration-200 cursor-pointer ${isSelected ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_15px_rgba(255,122,47,0.2)]' : 'bg-[#141414] border-[#232323] text-[#F5F5F5] hover:border-[#353534] disabled:opacity-50'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-heading font-semibold text-white">{item.label}</span>
                        <Clock size={18} className={isSelected ? 'text-[#FF7A2F]' : 'text-[#353534]'} />
                      </div>
                      <p className="text-sm text-[#8C8C8C]">{item.desc}</p>
                    </button>
                  );
                })}
              </div>
            </details>

            {/* Language */}
            <details className="group" open={openSections.has('language')}>
              <summary onClick={(e) => { e.preventDefault(); toggleSection('language'); }} className="flex items-center justify-between p-3 rounded-[12px] bg-[#141414] border border-[#232323] cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <Globe size={18} className="text-[#FF7A2F]" />
                  <span className="font-heading font-semibold text-white">Language</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#232323] text-xs text-[#8C8C8C] font-mono">Optional</span>
                </div>
                <ChevronDown className="w-5 h-5 text-[#8C8C8C] group-[&[open]]:rotate-180 transition-transform" />
              </summary>
              <div className="grid grid-cols-3 gap-2.5 pt-2 animate-slide-down">
                {LANGUAGES.map((lang) => {
                  const isSelected = languages.includes(lang);
                  return (
                    <button
                      key={lang}
                      onClick={() => !disabled && onChange({ languages: [lang] })}
                      disabled={disabled}
                      aria-pressed={isSelected}
                      className={`p-3 rounded-[12px] border text-center transition-all duration-200 cursor-pointer ${isSelected ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_12px_rgba(255,122,47,0.18)] font-semibold' : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white disabled:opacity-50'}`}
                    >
                      <span className="text-sm font-medium">{lang}</span>
                    </button>
                  );
                })}
              </div>
            </details>

            {/* Preference Toggles */}
            <details className="group" open={openSections.has('preferences')}>
              <summary onClick={(e) => { e.preventDefault(); toggleSection('preferences'); }} className="flex items-center justify-between p-3 rounded-[12px] bg-[#141414] border border-[#232323] cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <Star size={18} className="text-[#FF7A2F]" />
                  <span className="font-heading font-semibold text-white">Preference filters</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#232323] text-xs text-[#8C8C8C] font-mono">Optional</span>
                </div>
                <ChevronDown className="w-5 h-5 text-[#8C8C8C] group-[&[open]]:rotate-180 transition-transform" />
              </summary>
              <div className="space-y-3 pt-2 animate-slide-down">
                {PREFERENCE_TOGGLES.filter((t) => t.id !== 'mature' || audience !== 'Family with kids').map((item) => {
                  const checked = preferences[item.id];
                  return (
                    <div key={item.id} className="p-4 rounded-[12px] bg-[#141414] border border-[#232323] flex items-center justify-between gap-4">
                      <div>
                        <div className="font-heading font-semibold text-white">{item.label}</div>
                        <div className="text-sm text-[#8C8C8C]">{item.desc}</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={checked}
                        aria-label={item.label}
                        onClick={() => {
                          if (disabled) return;
                          if (item.id === 'recent' && !checked) {
                            onChange({ preferences: { ...preferences, recent: true, classics: false } });
                          } else if (item.id === 'classics' && !checked) {
                            onChange({ preferences: { ...preferences, classics: true, recent: false } });
                          } else {
                            onChange({ preferences: { ...preferences, [item.id]: !checked } });
                          }
                        }}
                        disabled={disabled}
                        className={`w-12 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer ${checked ? 'bg-[#E63946]' : 'bg-[#232323]'} disabled:opacity-50`}
                      >
                        <span className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all ${checked ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                    </div>
                  );
                })}
                {audience === 'Family with kids' && (
                  <div className="p-3.5 rounded-[12px] bg-[#141414] border border-[#232323] text-xs text-[#8C8C8C] flex items-center justify-between">
                    <span>Include mature content</span>
                    <span className="text-[#FF7A2F] font-medium">Off (Family mode)</span>
                  </div>
                )}
              </div>
            </details>

            {/* Fine-tune options */}
            <details className="group" open={openSections.has('fineTune')}>
              <summary onClick={(e) => { e.preventDefault(); toggleSection('fineTune'); }} className="flex items-center justify-between p-3 rounded-[12px] bg-[#141414] border border-[#232323] cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <Brain size={18} className="text-[#FF7A2F]" />
                  <span className="font-heading font-semibold text-white">More ways to tune</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#232323] text-xs text-[#8C8C8C] font-mono">Optional</span>
                </div>
                <ChevronDown className="w-5 h-5 text-[#8C8C8C] group-[&[open]]:rotate-180 transition-transform" />
              </summary>
              <div className="space-y-5 p-4 pt-2 border-t border-[#232323] animate-slide-down">
                {/* Tone */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-[#F5F5F5]">Tone (pick up to 2)</label>
                  <div className="flex flex-wrap gap-2">
                    {FINE_TUNE_TONES.map((tone) => {
                      const checked = preferences.tones?.includes(tone);
                      return (
                        <button
                          key={tone}
                          type="button"
                          onClick={() => {
                            if (disabled) return;
                            const current = preferences.tones || [];
                            const next = checked
                              ? current.filter((t) => t !== tone)
                              : current.length < 2
                              ? [...current, tone]
                              : current;
                            onChange({ preferences: { ...preferences, tones: next } });
                          }}
                          disabled={disabled || (!checked && (preferences.tones?.length || 0) >= 2)}
                          aria-pressed={!!checked}
                          className={`px-3 py-2 rounded-[10px] border text-sm font-medium transition-all duration-200 cursor-pointer ${checked ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_10px_rgba(255,122,47,0.15)]' : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white disabled:opacity-50'}`}
                        >
                          {tone}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Pace */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-[#F5F5F5]">Pace</label>
                  <div className="flex flex-wrap gap-2">
                    {FINE_TUNE_PACE.map((p) => {
                      const checked = preferences.pace === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => !disabled && onChange({ preferences: { ...preferences, pace: checked ? undefined : p } })}
                          disabled={disabled}
                          aria-pressed={checked}
                          className={`px-3 py-2 rounded-[10px] border text-sm font-medium transition-all duration-200 cursor-pointer ${checked ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_10px_rgba(255,122,47,0.15)]' : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white disabled:opacity-50'}`}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Intensity */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-[#F5F5F5]">Intensity</label>
                  <div className="flex flex-wrap gap-2">
                    {FINE_TUNE_INTENSITY.map((i) => {
                      const checked = preferences.intensity === i;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => !disabled && onChange({ preferences: { ...preferences, intensity: checked ? undefined : i } })}
                          disabled={disabled}
                          aria-pressed={checked}
                          className={`px-3 py-2 rounded-[10px] border text-sm font-medium transition-all duration-200 cursor-pointer ${checked ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_10px_rgba(255,122,47,0.15)]' : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white disabled:opacity-50'}`}
                        >
                          {i}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Humor style */}
                {genres.includes('Comedy') && (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-[#F5F5F5]">Humor style</label>
                    <div className="flex flex-wrap gap-2">
                      {FINE_TUNE_HUMOR.map((h) => {
                        const checked = preferences.humorStyle === h;
                        return (
                          <button
                            key={h}
                            type="button"
                            onClick={() => !disabled && onChange({ preferences: { ...preferences, humorStyle: checked ? undefined : h } })}
                            disabled={disabled}
                            aria-pressed={checked}
                            className={`px-3 py-2 rounded-[10px] border text-sm font-medium transition-all duration-200 cursor-pointer ${checked ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_10px_rgba(255,122,47,0.15)]' : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white disabled:opacity-50'}`}
                          >
                            {h}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </details>

            {/* Reference Movies */}
            <details className="group" open={openSections.has('reference')}>
              <summary onClick={(e) => { e.preventDefault(); toggleSection('reference'); }} className="flex items-center justify-between p-3 rounded-[12px] bg-[#141414] border border-[#232323] cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <Zap size={18} className="text-[#FF7A2F]" />
                  <span className="font-heading font-semibold text-white">Movies you liked</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#232323] text-xs text-[#8C8C8C] font-mono">Optional</span>
                </div>
                <ChevronDown className="w-5 h-5 text-[#8C8C8C] group-[&[open]]:rotate-180 transition-transform" />
              </summary>
              <div className="space-y-3 pt-2 animate-slide-down">
                <label htmlFor="reference-movie-search" className="block text-sm font-medium text-[#F5F5F5] mb-2">
                  Movies you liked (optional, up to 3)
                </label>
                <div className="relative">
                  <div className="flex items-center">
                    <input
                      ref={inputRef}
                      type="text"
                      id="reference-movie-search"
                      value={referenceSearchQuery}
                      onChange={handleReferenceSearchChange}
                      placeholder="e.g. Wolf of Wall Street, The Social Network"
                      className="w-full pl-10 pr-4 py-3 rounded-[12px] bg-[#0A0A0A] border border-[#232323] focus:border-[#FF7A2F] text-[#F5F5F5] placeholder-[#8C8C8C] outline-none transition-all duration-200"
                      maxLength={80}
                      aria-describedby="reference-search-status"
                      disabled={disabled}
                    />
                  </div>
                  {referenceSearchLoading && (
                    <div className="absolute right-10 top-1/2 -translate-y-1/2" aria-hidden="true">
                      <Zap className="w-5 h-5 text-[#FF7A2F] animate-spin" />
                    </div>
                  )}
                </div>
                <p id="reference-search-status" role="status" aria-live="polite" className={`text-xs mt-1 ${referenceSearchError ? 'text-[#E63946]' : 'text-[#8C8C8C]'}`}>
                  {referenceSearchLoading ? 'Searching titles…' : referenceSearchError ? referenceSearchError : referenceSuggestions.length > 0 ? `${referenceSuggestions.length} title${referenceSuggestions.length === 1 ? '' : 's'} found.` : ''}
                </p>
                {referenceSuggestions.length > 0 && (
                  <ul ref={suggestionsContainerRef} className="absolute z-10 w-full mt-1 bg-[#141414] border border-[#232323] rounded-[12px] max-h-60 overflow-auto">
                    {referenceSuggestions.map((s) => (
                      <li key={`${s.imdbId}-${s.year}`} className="border-b border-[#232323] last:border-0">
                        <button
                          type="button"
                          onClick={() => addReferenceMovie(s)}
                          disabled={disabled}
                          className="w-full px-4 py-3 hover:bg-[#1c1b1b] focus:bg-[#1c1b1b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A2F] cursor-pointer flex items-center gap-3 text-left disabled:opacity-50"
                        >
                          {s.posterUrl ? (
                            <img src={s.posterUrl} alt="" aria-hidden="true" className="w-12 h-18 object-cover rounded-[6px] bg-[#232323]" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                          ) : (
                            <div className="w-12 h-18 rounded-[6px] bg-[#232323] shrink-0" aria-hidden="true" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#F5F5F5] truncate">{s.title}</p>
                            <p className="text-xs text-[#8C8C8C]">{s.year}</p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {referenceMovies.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {referenceMovies.map((ref) => (
                      <span key={ref.imdbId} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1c1b1b] border border-[#FF7A2F]/40 text-xs text-[#F5F5F5]">
                        <span>Using</span>
                        <span className="font-medium">{ref.title}</span>
                        <span className="text-[#8C8C8C]">({ref.year})</span>
                        <button type="button" onClick={() => removeReferenceMovie(ref.imdbId)} disabled={disabled} className="ml-1 p-0.5 hover:text-[#E63946] transition-colors disabled:opacity-50" aria-label={`Remove ${ref.title}`}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </details>

            {/* Note */}
            <details className="group" open={openSections.has('note')}>
              <summary onClick={(e) => { e.preventDefault(); toggleSection('note'); }} className="flex items-center justify-between p-3 rounded-[12px] bg-[#141414] border border-[#232323] cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <Heart size={18} className="text-[#FF7A2F]" />
                  <span className="font-heading font-semibold text-white">Personal note</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#232323] text-xs text-[#8C8C8C] font-mono">Optional</span>
                </div>
                <ChevronDown className="w-5 h-5 text-[#8C8C8C] group-[&[open]]:rotate-180 transition-transform" />
              </summary>
              <div className="space-y-2 pt-2 animate-slide-down">
                <label htmlFor="fine-tune-notes" className="block text-sm font-medium text-[#F5F5F5]">Add a note (optional, max 200 chars)</label>
                <div className="relative">
                  <textarea
                    id="fine-tune-notes"
                    value={note}
                    onChange={(e) => onChange({ note: e.target.value.slice(0, 200) })}
                    placeholder="e.g. Loved 'Knives Out' and 'Arrival', no heavy gore please..."
                    maxLength={200}
                    rows={4}
                    className="w-full p-4 rounded-[12px] bg-[#0A0A0A] border border-[#232323] focus:border-[#E63946] text-[#F5F5F5] placeholder-[#8C8C8C] outline-none transition-all duration-200 resize-none font-normal text-base shadow-inner focus:shadow-[0_0_12px_rgba(230,57,70,0.25)]"
                    disabled={disabled}
                  />
                  <span className="absolute bottom-3 right-3 text-xs text-[#8C8C8C] font-mono">{note.length} / 200</span>
                </div>
              </div>
            </details>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-[#232323] sticky bottom-0 bg-[#0A0A0A]/95 backdrop-blur-sm">
            <button
              onClick={onClose}
              className="w-full py-3.5 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_0_20px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.01] active:scale-[0.98] cursor-pointer"
            >
              <Check size={16} />
              <span>Apply filters</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

// Re-export INITIAL_STATE for the clear button
export const INITIAL_WIZARD_STATE = {
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