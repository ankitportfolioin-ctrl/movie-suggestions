import React from 'react';
import { Sparkles, Laugh, Sofa, Zap, Heart, Compass, Brain, Film } from 'lucide-react';

export interface MoodOption {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  // Maps to existing WizardState mood values
  wizardMood: string;
}

export const MOOD_OPTIONS: MoodOption[] = [
  {
    id: 'surprise',
    label: 'Surprise me',
    desc: 'Anything great — I trust you',
    icon: <Sparkles className="w-6 h-6" />,
    wizardMood: 'Relaxed',
  },
  {
    id: 'cozy',
    label: 'Cozy & chill',
    desc: 'Low effort, high comfort',
    icon: <Sofa className="w-6 h-6" />,
    wizardMood: 'Relaxed',
  },
  {
    id: 'laugh',
    label: 'Make me laugh',
    desc: 'Comedy, light & fun',
    icon: <Laugh className="w-6 h-6" />,
    wizardMood: 'Happy',
  },
  {
    id: 'exciting',
    label: 'Exciting & intense',
    desc: 'Action, thrills, edge-of-seat',
    icon: <Zap className="w-6 h-6" />,
    wizardMood: 'Adventurous',
  },
  {
    id: 'thoughtful',
    label: 'Thought-provoking',
    desc: 'Mystery, sci-fi, mind-bending',
    icon: <Brain className="w-6 h-6" />,
    wizardMood: 'Curious',
  },
  {
    id: 'romantic',
    label: 'Romantic vibes',
    desc: 'Tender, intimate, chemistry',
    icon: <Heart className="w-6 h-6" />,
    wizardMood: 'Romantic',
  },
];

interface MoodSelectorProps {
  selectedMood: string | null;
  onSelect: (moodId: string) => void;
  disabled?: boolean;
}

export const MoodSelector: React.FC<MoodSelectorProps> = ({
  selectedMood,
  onSelect,
  disabled = false,
}) => {
  return (
    <div className="space-y-3" role="radiogroup" aria-label="Choose your mood">
      {MOOD_OPTIONS.map((mood) => (
        <button
          key={mood.id}
          type="button"
          onClick={() => !disabled && onSelect(mood.id)}
          disabled={disabled}
          aria-pressed={selectedMood === mood.id}
          role="radio"
          className={`w-full relative p-4 rounded-[16px] border text-left transition-all duration-200 cursor-pointer flex items-center gap-4 ${
            selectedMood === mood.id
              ? 'bg-[#1c1b1b] border-[#FF7A2F] shadow-[0_0_15px_rgba(255,122,47,0.2)] text-white'
              : 'bg-[#141414] border-[#232323] text-[#8C8C8C] hover:border-[#353534] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
        >
          <span
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              selectedMood === mood.id
                ? 'bg-[#FF7A2F]/10 text-[#FF7A2F]'
                : 'bg-[#0A0A0A] text-[#8C8C8C]'
            }`}
            aria-hidden="true"
          >
            {mood.icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-heading font-semibold text-base">{mood.label}</div>
            <div className="text-sm text-[#8C8C8C] mt-0.5">{mood.desc}</div>
          </div>
          {selectedMood === mood.id && (
            <span className="w-5 h-5 rounded-full border-2 border-[#FF7A2F] flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-[#FF7A2F]" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

export function getWizardMoodFromId(moodId: string): string {
  const option = MOOD_OPTIONS.find((m) => m.id === moodId);
  return option?.wizardMood ?? 'Relaxed';
}