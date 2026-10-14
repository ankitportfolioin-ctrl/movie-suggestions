import React from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Check,
  Laugh,
  Sofa,
  BedDouble,
  Flower2,
  Heart,
  Compass,
  Brain,
  Droplet,
  User,
  Users,
  Baby,
  Clock,
  X,
} from 'lucide-react';
import { WizardState } from '../types';

interface WizardProps {
  state: WizardState;
  onChange: (updates: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  isLoading: boolean;
  touchedSteps: number[];
}

const STEP_NAMES = [
  '',
  'Current Mood',
  'Genre Filter',
  'Company',
  'Runtime Window',
  'Dialogue Language',
  'Refinements',
  'Personal Note',
];

const MOODS = [
  { label: 'Happy', desc: 'Upbeat & lighthearted', icon: Laugh },
  { label: 'Relaxed', desc: 'Cozy & easygoing', icon: Sofa },
  { label: 'Tired', desc: 'Low cognitive load', icon: BedDouble },
  { label: 'Stressed', desc: 'Cathartic decompression', icon: Flower2 },
  { label: 'Romantic', desc: 'Tender & intimate', icon: Heart },
  { label: 'Adventurous', desc: 'High momentum', icon: Compass },
  { label: 'Curious', desc: 'Mind-bending & novel', icon: Brain },
  { label: 'Sad', desc: 'Bittersweet or grounding', icon: Droplet },
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
  { label: 'Just me', desc: 'Full personal indulgence, no compromises.', icon: User },
  { label: 'Partner', desc: 'Engaging chemistry, shared interest sweet-spot.', icon: Heart },
  { label: 'Friends', desc: 'Crowd-pleasing dialogue and lively momentum.', icon: Users },
  { label: 'Family with kids', desc: 'Kid-friendly, safe themes, all-ages charm.', icon: Baby },
];

const RUNTIMES = [
  { label: 'Under 90 min', desc: 'Brisk & punchy' },
  { label: 'Under 2 hours', desc: 'Standard cinematic duration' },
  { label: 'Under 2.5 hours', desc: 'Epic narratives with room to breathe' },
  { label: 'Any length', desc: 'No time constraints tonight' },
];

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

export const Wizard: React.FC<WizardProps> = ({
  state,
  onChange,
  onNext,
  onBack,
  onCancel,
  onSubmit,
  isLoading,
}) => {
  const { step, mood, genres, audience, maxRuntime, languages, preferences, note } = state;

  // Toggle genre logic (up to 3, handling "Surprise me"; blocked past 3)
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

  const genreCounter = genres.includes('Surprise me')
    ? 'Surprise me selected'
    : `${genres.filter((g) => g !== 'Surprise me').length}/3 selected`;

  return (
    <div className="flex flex-col flex-grow w-full max-w-2xl mx-auto px-4 py-8 justify-between">
      {/* Top navigation: step badge + counter */}
      <div className="flex items-center justify-between mb-6">
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#141414] border border-[#232323] text-xs font-medium text-[#FF7A2F]">
          {STEP_NAMES[step]}
        </span>
        <span className="text-xs font-mono text-[#8C8C8C]">
          Question {step} of 7
        </span>
      </div>

      {/* Session snapshot - only show choices user has made (touchedSteps) */}
      <div className="flex items-center flex-wrap gap-2 mb-8 px-4 py-2.5 rounded-[12px] bg-[#101010] border border-[#1c1c1c] text-xs text-[#8C8C8C]">
        <span className="font-medium tracking-wider uppercase text-[10px] text-[#666666]">
          Session Snapshot:
        </span>
        {touchedSteps.includes(1) && (
          <span className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#232323] text-[#d0d0d0]">
            Mood: {mood}
          </span>
        )}
        {touchedSteps.includes(2) && (
          <span className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#232323] text-[#d0d0d0]">
            Genres: {genres.filter(g => g !== 'Surprise me').join(', ') || 'Surprise me'}
          </span>
        )}
        {touchedSteps.includes(3) && (
          <span className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#232323] text-[#d0d0d0]">
            Company: {audience}
          </span>
        )}
        {touchedSteps.includes(4) && (
          <span className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#232323] text-[#d0d0d0]">
            Runtime: {maxRuntime}
          </span>
        )}
        {touchedSteps.includes(5) && (
          <span className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#232323] text-[#d0d0d0]">
            Language: {languages.join(', ')}
          </span>
        )}
        {touchedSteps.includes(6) && (
          <>
            {Object.entries(preferences).map(([key, value]) => value && (
              <span key={key} className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#232323] text-[#d0d0d0]">
                {key === 'highlyRated' && 'Highly rated (7+)'}
                {key === 'hiddenGems' && 'Hidden gems'}
                {key === 'recent' && 'Recent (5 years)'}
                {key === 'classics' && 'Classics (pre-2000)'}
                {key === 'mature' && 'Mature content'}
              </span>
            ))}
          </>
        )}
      </div>

      {/* Main Question Container */}
      <div className="flex-grow flex flex-col justify-center my-auto py-4">
        {/* QUESTION 1: MOOD */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
                How are you feeling right now?
              </h2>
              <p className="text-sm text-[#8C8C8C] mt-2">
                Pick the dominant vibe that fits your headspace tonight.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              {MOODS.map((item) => {
                const isSelected = mood === item.label;
                return (
                  <button
                    key={item.label}
                    onClick={() => onChange({ mood: item.label })}
                    className={`p-3.5 rounded-[12px] border text-left transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? 'bg-[#1c1b1b] border-[#FF7A2F] shadow-[0_0_15px_rgba(255,122,47,0.2)] text-white'
                        : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <item.icon
                        size={20}
                        className={isSelected ? 'text-[#FF7A2F]' : 'text-[#8C8C8C]'}
                      />
                      {isSelected && <span className="w-2 h-2 rounded-full bg-[#FF7A2F]" />}
                    </div>
                    <div className="font-heading font-semibold text-white mb-0.5">{item.label}</div>
                    <div className="text-[11px] leading-tight text-[#8C8C8C] line-clamp-1">
                      {item.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* QUESTION 2: GENRES */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-baseline justify-between">
                <h2 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
                  Select Genres
                </h2>
                <span className="text-xs text-[#8C8C8C] shrink-0">Max 3</span>
              </div>
              <p className="text-sm text-[#8C8C8C] mt-2">
                Choose up to 3 genres, or select surprise me.
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 pt-2">
              {GENRES.map((g) => {
                const isSelected = genres.includes(g);
                return (
                  <button
                    key={g}
                    onClick={() => handleGenreToggle(g)}
                    className={`px-4 py-2.5 rounded-[12px] border text-sm font-medium transition-all duration-200 cursor-pointer flex items-center gap-2 ${
                      isSelected
                        ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_12px_rgba(255,122,47,0.18)]'
                        : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white'
                    }`}
                  >
                    <span>{g}</span>
                    {isSelected && <Check size={13} className="text-[#FF7A2F]" />}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[#666666] font-mono">{genreCounter}</p>
          </div>
        )}

        {/* QUESTION 3: AUDIENCE */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
                Who is watching?
              </h2>
              <p className="text-sm text-[#8C8C8C] mt-2">
                This calibrates pacing, tone, and maturity guardrails.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
              {AUDIENCES.map((item) => {
                const isSelected = audience === item.label;
                return (
                  <button
                    key={item.label}
                    onClick={() => onChange({ audience: item.label })}
                    className={`p-4 rounded-[12px] border text-left transition-all duration-200 cursor-pointer flex items-start gap-3.5 ${
                      isSelected
                        ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_15px_rgba(255,122,47,0.2)]'
                        : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-[#FF7A2F]/10 text-[#FF7A2F]'
                          : 'bg-[#0A0A0A] text-[#8C8C8C]'
                      }`}
                    >
                      <item.icon size={20} />
                    </div>
                    <div>
                      <div className="font-heading font-semibold text-white mb-0.5">
                        {item.label}
                      </div>
                      <div className="text-sm text-[#8C8C8C]">{item.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* QUESTION 4: RUNTIME */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
                Time Available
              </h2>
              <p className="text-sm text-[#8C8C8C] mt-2">
                How long do you want the cinematic journey to be?
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
              {RUNTIMES.map((item) => {
                const isSelected = maxRuntime === item.label;
                return (
                  <button
                    key={item.label}
                    onClick={() => onChange({ maxRuntime: item.label })}
                    className={`p-4 rounded-[12px] border text-left transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_15px_rgba(255,122,47,0.2)]'
                        : 'bg-[#141414] border-[#232323] text-[#F5F5F5] hover:border-[#353534]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-heading font-semibold text-white">{item.label}</span>
                      <Clock
                        size={18}
                        className={isSelected ? 'text-[#FF7A2F]' : 'text-[#353534]'}
                      />
                    </div>
                    <p className="text-sm text-[#8C8C8C]">{item.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* QUESTION 5: LANGUAGE (single select) */}
        {step === 5 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
                Preferred Audio / Language
              </h2>
              <p className="text-sm text-[#8C8C8C] mt-2">
                Select original dialogue preferences.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2.5 pt-2">
              {LANGUAGES.map((lang) => {
                const isSelected = languages.includes(lang);
                return (
                  <button
                    key={lang}
                    onClick={() => onChange({ languages: [lang] })}
                    className={`p-3 rounded-[12px] border text-center transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? 'bg-[#1c1b1b] border-[#FF7A2F] text-white shadow-[0_0_12px_rgba(255,122,47,0.18)] font-semibold'
                        : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white'
                    }`}
                  >
                    <span className="text-sm font-medium">{lang}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* QUESTION 6: PREFERENCES (switch toggles) */}
        {step === 6 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
                Fine-tune Preferences
              </h2>
              <p className="text-sm text-[#8C8C8C] mt-2">
                Toggle specific criteria for higher precision.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              {PREFERENCE_TOGGLES.filter(
                (t) => t.id !== 'mature' || audience !== 'Family with kids'
              ).map((item) => {
                const checked = preferences[item.id];
                return (
                  <div
                    key={item.id}
                    className="p-4 rounded-[12px] bg-[#141414] border border-[#232323] flex items-center justify-between gap-4"
                  >
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
                        if (item.id === 'recent' && !checked) {
                          onChange({
                            preferences: { ...preferences, recent: true, classics: false },
                          });
                        } else if (item.id === 'classics' && !checked) {
                          onChange({
                            preferences: { ...preferences, classics: true, recent: false },
                          });
                        } else {
                          onChange({
                            preferences: { ...preferences, [item.id]: !checked },
                          });
                        }
                      }}
                      className={`w-12 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer ${
                        checked ? 'bg-[#E63946]' : 'bg-[#232323]'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all ${
                          checked ? 'right-0.5' : 'left-0.5'
                        }`}
                      />
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
          </div>
        )}

        {/* QUESTION 7: OPTIONAL FREE TEXT */}
        {step === 7 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
                Anything else?
              </h2>
              <p className="text-sm text-[#8C8C8C] mt-2">
                A movie you loved recently, an actor you dislike, or a specific mood keyword.
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <div className="relative">
                <textarea
                  id="quiz-user-notes"
                  value={note}
                  onChange={(e) => onChange({ note: e.target.value.slice(0, 200) })}
                  placeholder="e.g. Loved 'Knives Out' and 'Arrival', no heavy gore please..."
                  maxLength={200}
                  rows={4}
                  className="w-full p-4 rounded-[12px] bg-[#0A0A0A] border border-[#232323] focus:border-[#E63946] text-[#F5F5F5] placeholder-[#666666] outline-none transition-all duration-200 resize-none font-normal text-base shadow-inner focus:shadow-[0_0_12px_rgba(230,57,70,0.25)]"
                />
                <span className="absolute bottom-3 right-3 text-xs text-[#666666] font-mono">
                  {note.length} / 200
                </span>
              </div>
            </div>

            {/* Summary chips + big CTA */}
            <div className="flex items-center flex-wrap gap-2 pt-1">
              <span
                id="summary-mood"
                className="px-3 py-1.5 rounded-full bg-[#1a1a1a] border border-[#FF7A2F]/40 text-xs text-[#F5F5F5]"
              >
                Mood: {mood}
              </span>
              <span
                id="summary-genres"
                className="px-3 py-1.5 rounded-full bg-[#1a1a1a] border border-[#FF7A2F]/40 text-xs text-[#F5F5F5]"
              >
                Genres: {genres.join(', ') || 'Any'}
              </span>
              <span
                id="summary-runtime"
                className="px-3 py-1.5 rounded-full bg-[#1a1a1a] border border-[#FF7A2F]/40 text-xs text-[#F5F5F5]"
              >
                {maxRuntime}
              </span>
            </div>

            <button
              onClick={onSubmit}
              disabled={isLoading}
              className="w-full py-4 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-lg flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_0_25px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-5 h-5" />
              <span>Find my movies</span>
            </button>
          </div>
        )}
      </div>

      {/* Bottom Action Bar (hidden on step 7: it has its own CTA) */}
      {step < 7 && (
        <div className="pt-8 flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-5 py-4 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#383838] text-[#8C8C8C] hover:text-[#F5F5F5] font-medium text-sm flex items-center gap-2 transition-all duration-200 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <button
            onClick={onCancel}
            className="px-5 py-4 rounded-[16px] bg-transparent border border-transparent hover:border-[#232323] text-[#666666] hover:text-[#8C8C8C] font-medium text-sm flex items-center gap-2 transition-all duration-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span>Cancel</span>
          </button>
          <button
            onClick={onNext}
            className="flex-1 py-4 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-lg flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_0_25px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
          >
            <span>Continue</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};
