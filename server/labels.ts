/**
 * Movie labeler: derives tone, pace, intensity, and humor labels
 * from genres, keywords, certificate, and overview.
 * Results are cached so each movie is labeled once.
 */

import { MovieItem } from './catalog.js';

export interface MovieLabels {
  tone: string[]; // Light & fun, Thoughtful, Intense, Dark, Uplifting
  pace: string; // Slow-burn, Medium, Fast
  intensity: string; // No violence, Mild, Moderate, Any
  humor: string[]; // Slapstick, Witty, Dark comedy, Satirical
  confidence: number; // 0-1
}

const LABEL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const labelCache = new Map<string, { labels: MovieLabels; expiresAt: number }>();

const TONE_KEYWORDS: Record<string, string[]> = {
  'Light & fun': ['comedy', 'funny', 'hilarious', 'lighthearted', 'feel-good', 'charming', 'whimsical', 'amusing'],
  Thoughtful: ['thoughtful', 'philosophical', 'introspective', 'contemplative', 'meditative', 'cerebral', 'nuanced', 'layered'],
  Intense: ['intense', 'gripping', 'visceral', 'harrowing', 'relentless', 'high-stakes', 'edge-of-your-seat', 'pulse-pounding'],
  Dark: ['dark', 'gritty', 'bleak', 'grim', 'noir', 'cynical', 'disturbing', 'macabre', 'sinister', 'twisted'],
  Uplifting: ['uplifting', 'inspiring', 'hopeful', 'heartwarming', 'triumphant', 'redemptive', 'joyful', 'affirming'],
};

const PACE_KEYWORDS: Record<string, string[]> = {
  'Slow-burn': ['slow-burn', 'deliberate', 'measured', 'patient', 'gradual', 'unhurried', 'atmospheric', 'languid'],
  Medium: ['balanced', 'steady', 'moderate', 'well-paced', 'even'],
  Fast: ['fast-paced', 'rapid', 'breakneck', 'frantic', 'kinetic', 'high-octane', 'propulsive', 'relentless', 'action-packed'],
};

const INTENSITY_KEYWORDS: Record<string, string[]> = {
  'No violence': ['gentle', 'peaceful', 'non-violent', 'wholesome', 'family-friendly', 'innocent'],
  Mild: ['mild', 'light', 'tame', 'restrained', 'subtle', 'suggested'],
  Moderate: ['moderate', 'some violence', 'action violence', 'peril', 'suspense'],
  Any: ['graphic', 'brutal', 'gory', 'visceral', 'extreme', 'hard-hitting'],
};

const HUMOR_KEYWORDS: Record<string, string[]> = {
  Slapstick: ['slapstick', 'physical comedy', 'farce', 'pratfall', 'clowning', 'silly', 'goofy'],
  Witty: ['witty', 'clever', 'sharp', 'banter', 'wordplay', 'dry humor', 'sardonic', 'intelligent comedy'],
  'Dark comedy': ['dark comedy', 'black comedy', 'gallows humor', 'morbid', 'cynical comedy', 'satirical'],
  Satirical: ['satire', 'satirical', 'parody', 'spoof', 'social commentary', 'mocking', 'ironic'],
};

const INTENSITY_ORDER = ['No violence', 'Mild', 'Moderate', 'Any'];
const PACE_ORDER = ['Slow-burn', 'Medium', 'Fast'];

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z'-]{3,}/g) || [];
  return new Set(words);
}

function scoreLabels(keywords: Set<string>, labelKeywords: Record<string, string[]>): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [label, kws] of Object.entries(labelKeywords)) {
    let score = 0;
    for (const kw of kws) {
      if (keywords.has(kw.toLowerCase())) score += 1;
      // Partial match for multi-word keywords
      else if (kw.includes(' ') && textIncludes(keywords, kw.toLowerCase())) score += 0.5;
    }
    scores[label] = score;
  }
  return scores;
}

function textIncludes(keywords: Set<string>, phrase: string): boolean {
  const words = phrase.split(' ');
  return words.every((w) => keywords.has(w));
}

function inferFromGenres(genres: string[]): Partial<MovieLabels> {
  const labels: Partial<MovieLabels> = {};
  const genreSet = new Set(genres.map((g) => g.toLowerCase()));

  // Tone from genres
  if (genreSet.has('comedy') || genreSet.has('animation') || genreSet.has('family')) {
    labels.tone = ['Light & fun', 'Uplifting'];
  }
  if (genreSet.has('drama') || genreSet.has('documentary')) {
    labels.tone = [...(labels.tone || []), 'Thoughtful'];
  }
  if (genreSet.has('thriller') || genreSet.has('horror') || genreSet.has('action')) {
    labels.tone = [...(labels.tone || []), 'Intense', 'Dark'];
  }
  if (genreSet.has('crime') || genreSet.has('mystery') || genreSet.has('noir')) {
    labels.tone = [...(labels.tone || []), 'Dark', 'Thoughtful'];
  }
  if (genreSet.has('romance') || genreSet.has('fantasy')) {
    labels.tone = [...(labels.tone || []), 'Uplifting', 'Light & fun'];
  }

  // Pace from genres
  if (genreSet.has('action') || genreSet.has('thriller') || genreSet.has('adventure')) {
    labels.pace = 'Fast';
  } else if (genreSet.has('documentary') || genreSet.has('drama') || genreSet.has('romance')) {
    labels.pace = 'Slow-burn';
  } else {
    labels.pace = 'Medium';
  }

  // Intensity from genres
  if (genreSet.has('family') || genreSet.has('animation') || genreSet.has('comedy')) {
    if (!genreSet.has('action') && !genreSet.has('thriller') && !genreSet.has('horror')) {
      labels.intensity = 'No violence';
    }
  }
  if (genreSet.has('horror') || genreSet.has('war') || genreSet.has('crime')) {
    labels.intensity = 'Moderate';
  }
  if (genreSet.has('action') && (genreSet.has('war') || genreSet.has('crime'))) {
    labels.intensity = 'Any';
  }

  // Humor from genres
  if (genreSet.has('comedy')) {
    labels.humor = ['Witty', 'Slapstick'];
  }

  return labels;
}

function inferFromCertificate(certificate: string | undefined): Partial<MovieLabels> {
  const labels: Partial<MovieLabels> = {};
  const cert = certificate?.toUpperCase() || '';

  if (['G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG', 'U'].includes(cert)) {
    labels.intensity = 'No violence';
  } else if (['PG-13', 'TV-14', '12', '12A'].includes(cert)) {
    labels.intensity = 'Mild';
  } else if (['R', 'NC-17', 'TV-MA', '15', '18', '18+', 'A', 'X'].includes(cert)) {
    labels.intensity = 'Any';
  }

  return labels;
}

export function labelMovie(movie: MovieItem): MovieLabels {
  const cacheKey = `labels:${movie.id}:${movie.year}`;
  const now = Date.now();
  const cached = labelCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.labels;
  }

  const overview = movie.overview || '';
  const keywords = extractKeywords(overview);
  const genreLabels = inferFromGenres(movie.genres);
  const certLabels = inferFromCertificate(movie.certificate);

  // Score tones
  const toneScores = scoreLabels(keywords, TONE_KEYWORDS);
  const toneFromGenres = genreLabels.tone || [];
  for (const t of toneFromGenres) {
    toneScores[t] = (toneScores[t] || 0) + 1;
  }
  const sortedTones = Object.entries(toneScores).sort((a, b) => b[1] - a[1]);
  const tone = sortedTones.filter(([, s]) => s > 0).slice(0, 2).map(([t]) => t);
  const finalTone = tone.length > 0 ? tone : ['Light & fun'];

  // Score pace
  const paceScores = scoreLabels(keywords, PACE_KEYWORDS);
  if (genreLabels.pace) paceScores[genreLabels.pace] = (paceScores[genreLabels.pace] || 0) + 1;
  const sortedPace = Object.entries(paceScores).sort((a, b) => b[1] - a[1]);
  const pace = sortedPace[0]?.[0] || genreLabels.pace || 'Medium';

  // Score intensity
  const intensityScores = scoreLabels(keywords, INTENSITY_KEYWORDS);
  if (genreLabels.intensity) intensityScores[genreLabels.intensity] = (intensityScores[genreLabels.intensity] || 0) + 1;
  if (certLabels.intensity) intensityScores[certLabels.intensity] = (intensityScores[certLabels.intensity] || 0) + 2; // Certificate weighted higher
  const sortedIntensity = Object.entries(intensityScores).sort((a, b) => {
    const idxA = INTENSITY_ORDER.indexOf(a[0]);
    const idxB = INTENSITY_ORDER.indexOf(b[0]);
    if (idxA !== -1 && idxB !== -1) return idxB - idxA; // Higher intensity wins
    return b[1] - a[1];
  });
  const intensity = sortedIntensity[0]?.[0] || genreLabels.intensity || certLabels.intensity || 'Mild';

  // Score humor
  const humorScores = scoreLabels(keywords, HUMOR_KEYWORDS);
  const humorFromGenres = genreLabels.humor || [];
  for (const h of humorFromGenres) {
    humorScores[h] = (humorScores[h] || 0) + 1;
  }
  const sortedHumor = Object.entries(humorScores).sort((a, b) => b[1] - a[1]);
  const humor = sortedHumor.filter(([, s]) => s > 0).map(([h]) => h);
  const finalHumor = humor.length > 0 ? humor : ['Witty'];

  // Confidence based on how many signals we have
  const signalCount = [
    toneScores[finalTone[0]] || 0,
    paceScores[pace] || 0,
    intensityScores[intensity] || 0,
    humorScores[finalHumor[0]] || 0,
  ].filter((s) => s > 0).length;
  const confidence = Math.min(0.5 + signalCount * 0.15, 1);

  const labels: MovieLabels = {
    tone: finalTone,
    pace,
    intensity,
    humor: finalHumor,
    confidence,
  };

  labelCache.set(cacheKey, { labels, expiresAt: now + LABEL_CACHE_TTL });
  return labels;
}

export function getCachedLabels(movieId: number, year: number): MovieLabels | null {
  const cacheKey = `labels:${movieId}:${year}`;
  const cached = labelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.labels;
  }
  return null;
}