import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  X,
  Sparkles,
  Loader2,
  Check,
  User,
  Users,
  Heart,
  Baby,
  Clock,
  Zap,
  Brain,
  Laugh,
  Flower2,
  Droplet,
  Compass,
} from 'lucide-react';
import { WizardState, ReferenceMovie } from '../types';

interface PickForMeProps {
  onSubmit: (state: WizardState & { referenceMovies?: ReferenceMovie[] }) => void;
  onCancel: () => void;
  isLoading?: boolean;
  initialState?: Partial<WizardState & { referenceMovies?: ReferenceMovie[] }>;
}

/** Step 1: Who's watching? */
const AUDIENCE_OPTIONS = [
  { id: 'just-me', label: 'Just me', desc: 'Personal picks, no compromises', icon: User },
  { id: 'partner', label: 'Partner', desc: 'Shared interest sweet spot', icon: Heart },
  { id: 'friends', label: 'Friends', desc: 'Crowd-pleasing, lively momentum', icon: Users },
  { id: 'family', label: 'Family / kids', desc: 'Kid-friendly, safe themes', icon: Baby },
] as const;

/** Step 2: What sounds good? (moods) */
const MOOD_OPTIONS = [
  { id: 'mind-bending', label: 'Mind-bending', desc: 'Big ideas, reality shifts', icon: Zap },
  { id: 'suspenseful', label: 'Suspenseful', desc: 'Psychological, crime, thriller', icon: Brain },
  { id: 'funny', label: 'Funny', desc: 'Comedy that lands', icon: Laugh },
  { id: 'feel-good', label: 'Feel-good', desc: 'Uplifting, warm, rewarding', icon: Flower2 },
  { id: 'emotional', label: 'Emotional', desc: 'Moving, bittersweet, human', icon: Droplet },
  { id: 'adventurous', label: 'Adventurous', desc: 'High momentum, exploration', icon: Compass },
  { id: 'surprise', label: 'Surprise me', desc: 'Something unexpected', icon: Sparkles },
] as const;

/** Step 3: How much time? (optional) */
const RUNTIME_OPTIONS = [
  { id: 'under-90', label: 'Under 90 min', desc: 'Brisk & punchy' },
  { id: '90-120', label: '90–120 min', desc: 'Standard movie length' },
  { id: 'over-120', label: 'Over 2 hours', desc: 'Epic, room to breathe' },
  { id: 'episode', label: 'One episode', desc: '~45–60 min series episode' },
  { id: 'any', label: 'Any length', desc: 'No time constraint' },
] as const;

const STEP_LABELS = [
  '',
  'Who\'s watching?',
  'What sounds good?',
  'How much time? (optional)',
];

export const PickForMe: React.FC<PickForMeProps> = ({
  onSubmit,
  onCancel,
  isLoading = false,
  initialState = {},
}) => {
  const [step, setStep] = useState(1);
  const [audience, setAudience] = useState<string>(initialState.audience?.toLowerCase().replace(/\s+/g, '-') || '');
  const [mood, setMood] = useState<string>(initialState.mood?.toLowerCase().replace(/\s+/g, '-') || '');
  const [runtime, setRuntime] = useState<string>(initialState.maxRuntime?.toLowerCase().replace(/\s+/g, '-') || '');
  const [showKidsSafe, setShowKidsSafe] = useState(false);
  const [kidsSafe, setKidsSafe] = useState(false);

  // Map internal IDs to wizard state values
  const audienceMap: Record<string, string> = {
    'just-me': 'Just me',
    'partner': 'Partner',
    'friends': 'Friends',
    'family': 'Family with kids',
  };

  const moodMap: Record<string, string> = {
    'mind-bending': 'Mind-bending',
    'suspenseful': 'Suspenseful',
    'funny': 'Funny',
    'feel-good': 'Feel-good',
    'emotional': 'Emotional',
    'adventurous': 'Adventurous',
    'surprise': 'Surprise me',
  };

  const runtimeMap: Record<string, string> = {
    'under-90': 'Under 90 min',
    '90-120': 'Under 2 hours',
    'over-120': 'Under 2.5 hours',
    'episode': 'Miniseries (1 season)',
    'any': 'Any length',
  };

  // Show kids-safe toggle only for family audience
  useEffect(() => {
    setShowKidsSafe(audience === 'family');
    if (audience !== 'family') setKidsSafe(false);
  }, [audience]);

  const handleAudienceSelect = (id: string) => {
    setAudience(id);
    // Auto-advance after selection
    setTimeout(() => setStep(2), 150);
  };

  const handleMoodSelect = (id: string) => {
    setMood(id);
    // Auto-advance to optional time step
    setTimeout(() => setStep(3), 150);
  };

  const handleRuntimeSelect = (id: string) => {
    setRuntime(id);
  };

  const handleBack = () => {
    setStep((prev) => Math.max(1, prev - 1));
  };

  const handleSkipTime = () => {
    // Submit without runtime constraint
    const wizardState: WizardState & { referenceMovies?: ReferenceMovie[] } = {
      step: 9,
      types: ['movie'],
      mood: moodMap[mood] || 'Surprise me',
      genres: ['Surprise me'],
      audience: audienceMap[audience] || 'Just me',
      maxRuntime: runtime ? runtimeMap[runtime] : 'Any length',
      languages: ['Any'],
      preferences: {
        highlyRated: false,
        hiddenGems: false,
        recent: false,
        classics: false,
        mature: audience !== 'family',
      },
      note: '',
      referenceMovies: [],
    };
    if (kidsSafe) {
      wizardState.preferences.mature = false;
    }
    onSubmit(wizardState);
  };

  const handleFinish = () => {
    const wizardState: WizardState & { referenceMovies?: ReferenceMovie[] } = {
      step: 9,
      types: ['movie'],
      mood: moodMap[mood] || 'Surprise me',
      genres: ['Surprise me'],
      audience: audienceMap[audience] || 'Just me',
      maxRuntime: runtime ? runtimeMap[runtime] : 'Any length',
      languages: ['Any'],
      preferences: {
        highlyRated: false,
        hiddenGems: false,
        recent: false,
        classics: false,
        mature: audience !== 'family',
      },
      note: '',
      referenceMovies: [],
    };
    if (kidsSafe) {
      wizardState.preferences.mature = false;
    }
    onSubmit(wizardState);
  };

  const canSubmit = audience && mood;

  return (
    <div className="flex flex-col flex-grow w-full max-w-md mx-auto px-4 py-8 justify-between animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="pick-for-me-title">
      {/* Progress indicator */}
      <div className="flex items-center justify-between mb-6">
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#141414] border border-[#232323] text-xs font-medium text-[#FF7A2F]">
          Pick for me
        </span>
        <div className="flex items-center gap-1">
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                s < step ? 'bg-[#FF7A2F]' : s === step ? 'bg-[#FF7A2F]' : 'bg-[#232323]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Session snapshot - only show choices made */}
      <div className="flex items-center flex-wrap gap-2 mb-8 px-4 py-2.5 rounded-[12px] bg-[#101010] border border-[#1c1c1c] text-xs text-[#8C8C8C]">
        <span className="font-medium tracking-wider uppercase text-[10px] text-[#8C8C8C]">Your picks:</span>
        {audience && (
          <span className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#232323] text-[#d0d0d0]">
            {AUDIENCE_OPTIONS.find((a) => a.id === audience)?.label}
          </span>
        )}
        {mood && (
          <span className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#232323] text-[#d0d0d0]">
            {MOOD_OPTIONS.find((m) => m.id === mood)?.label}
          </span>
        )}
        {runtime && (
          <span className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#232323] text-[#d0d0d0]">
            {RUNTIME_OPTIONS.find((r) => r.id === runtime)?.label}
          </span>
        )}
        {kidsSafe && (
          <span className="px-2 py-0.5 rounded-md bg-[#1a1a1a] border border-[#FF7A2F]/40 text-[#FF7A2F]">
            Kids-safe only
          </span>
        )}
      </div>

      {/* Main Question Container */}
      <div className="flex-grow flex flex-col justify-center my-auto py-4">
        {/* STEP 1: AUDIENCE */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h1 id="pick-for-me-title" className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
                Who's watching?
              </h1>
              <p className="text-sm text-[#8C8C8C] mt-2">
                This sets the tone, pacing, and maturity guardrails.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
              {AUDIENCE_OPTIONS.map((item) => {
                const isSelected = audience === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleAudienceSelect(item.id)}
                    aria-pressed={isSelected}
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
                      <item.icon size={22} />
                    </div>
                    <div>
                      <div className="font-heading font-semibold text-white mb-0.5">{item.label}</div>
                      <div className="text-sm text-[#8C8C8C]">{item.desc}</div>
                    </div>
                    {isSelected && <Check size={20} className="text-[#FF7A2F] ml-auto" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 2: MOOD */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h1 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
                What sounds good?
              </h1>
              <p className="text-sm text-[#8C8C8C] mt-2">
                Pick the vibe that fits your headspace tonight.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
              {MOOD_OPTIONS.map((item) => {
                const isSelected = mood === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleMoodSelect(item.id)}
                    aria-pressed={isSelected}
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
                    <div className="text-[11px] leading-tight text-[#8C8C8C] line-clamp-2">{item.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 3: RUNTIME (optional) */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h1 className="font-heading text-3xl sm:text-4xl font-bold text-[#F5F5F5]">
                How much time do you have?
              </h1>
              <p className="text-sm text-[#8C8C8C] mt-2">
                Optional — skip to get picks of any length.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
              {RUNTIME_OPTIONS.map((item) => {
                const isSelected = runtime === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleRuntimeSelect(item.id)}
                    aria-pressed={isSelected}
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

            {/* Kids-safe toggle for family */}
            {showKidsSafe && (
              <div className="p-4 rounded-[12px] bg-[#1c1b1b] border border-[#FF7A2F]/40">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={kidsSafe}
                    onChange={(e) => setKidsSafe(e.target.checked)}
                    className="w-4 h-4 rounded border-[#232323] bg-[#0A0A0A] text-[#FF7A2F] focus:ring-[#FF7A2F] cursor-pointer"
                  />
                  <div>
                    <div className="font-medium text-white">Kids-safe only</div>
                    <div className="text-sm text-[#8C8C8C]">Restrict to age-appropriate certifications (G, PG, PG-13)</div>
                  </div>
                </label>
              </div>
            )}

            {/* Skip / Submit actions */}
            <div className="pt-4 flex items-center gap-3">
              <button
                onClick={handleSkipTime}
                className="px-5 py-3.5 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#383838] text-[#8C8C8C] hover:text-[#F5F5F5] font-medium text-sm flex items-center gap-2 transition-all duration-200 cursor-pointer"
              >
                <span>Skip</span>
              </button>
              <button
                onClick={handleFinish}
                disabled={isLoading || !canSubmit}
                className="flex-1 py-3.5 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-lg flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_0_25px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-5 h-5" />
                <span>Find my movies</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Action Bar (hidden on step 3) */}
      {step < 3 && (
        <div className="pt-8 flex items-center gap-3">
          <button
            onClick={handleBack}
            className="px-5 py-4 rounded-[16px] bg-[#141414] border border-[#232323] hover:border-[#383838] text-[#8C8C8C] hover:text-[#F5F5F5] font-medium text-sm flex items-center gap-2 transition-all duration-200 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <button
            onClick={onCancel}
            className="px-5 py-4 rounded-[16px] bg-transparent border border-transparent hover:border-[#232323] text-[#8C8C8C] hover:text-[#8C8C8C] font-medium text-sm flex items-center gap-2 transition-all duration-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span>Cancel</span>
          </button>
          <button
            onClick={() => setStep((prev) => prev + 1)}
            disabled={step === 1 ? !audience : !mood}
            className="flex-1 py-4 rounded-[16px] bg-gradient-to-br from-[#E63946] to-[#FF7A2F] text-white font-heading font-semibold text-lg flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_0_25px_-4px_rgba(255,122,47,0.45)] hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>Continue</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};