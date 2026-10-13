import { FALLBACK_CATALOG, MovieItem } from './catalog.js';

export const DEFAULT_REGION = 'IN';

export const GENRE_MAP: Record<string, number> = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  Horror: 27,
  Mystery: 9648,
  Romance: 10749,
  'Sci-Fi': 878,
  Thriller: 53,
};

export const MOOD_GENRES: Record<string, string[]> = {
  Happy: ['Comedy', 'Adventure', 'Animation'],
  Relaxed: ['Comedy', 'Romance', 'Animation', 'Family'],
  Tired: ['Comedy', 'Animation', 'Family'],
  Stressed: ['Comedy', 'Animation', 'Fantasy'],
  Romantic: ['Romance', 'Drama', 'Comedy'],
  Adventurous: ['Adventure', 'Action', 'Sci-Fi', 'Fantasy'],
  Curious: ['Mystery', 'Documentary', 'Sci-Fi', 'Crime'],
  Sad: ['Drama', 'Family', 'Comedy'],
};

export const LANGUAGE_CODES: Record<string, string> = {
  English: 'en',
  Hindi: 'hi',
  Tamil: 'ta',
  Telugu: 'te',
  Korean: 'ko',
  Japanese: 'ja',
  Spanish: 'es',
  French: 'fr',
};

// In-memory provider cache (1 hour)
interface CachedProvider {
  data: { name: string; logoUrl: string; type?: string }[];
  expiresAt: number;
}
const providerCache = new Map<string, CachedProvider>();

export interface MoviePick {
  id: number;
  title: string;
  year: number;
  genres: string[];
  runtime: number;
  rating: number;
  overview: string;
  posterUrl: string;
  providers: { name: string; logoUrl: string; type?: string }[];
  reason: string;
  isHiddenGem: boolean;
}

export interface RecommendParams {
  mood: string;
  genres: string[];
  audience: string;
  maxRuntime: string;
  languages: string[];
  preferences: {
    highlyRated?: boolean;
    hiddenGems?: boolean;
    recent?: boolean;
    classics?: boolean;
    mature?: boolean;
  };
  note?: string;
  excludeIds?: number[];
}

/**
 * Filter and pick from local fallback catalog if TMDB_API_KEY is not set or network fails
 */
export function filterFallbackCatalog(params: RecommendParams): MoviePick[] {
  const excludeSet = new Set(params.excludeIds || []);
  const isFamily = params.audience === 'Family with kids';
  const effectiveMature = !isFamily && Boolean(params.preferences?.mature);

  // Runtime threshold
  let maxMinutes = Infinity;
  if (params.maxRuntime === 'Under 90 min') maxMinutes = 90;
  else if (params.maxRuntime === 'Under 2 hours') maxMinutes = 120;
  else if (params.maxRuntime === 'Under 2.5 hours') maxMinutes = 150;

  // Desired genres
  const surpriseMe = params.genres.includes('Surprise me') || params.genres.length === 0;
  const moodGenreList = MOOD_GENRES[params.mood] || ['Comedy', 'Adventure'];
  const targetGenres = surpriseMe ? moodGenreList : params.genres.filter((g) => g !== 'Surprise me');

  // Desired languages
  const targetLangCodes: string[] = [];
  if (params.languages && params.languages.length > 0 && !params.languages.includes('Any')) {
    for (const lang of params.languages) {
      if (LANGUAGE_CODES[lang]) targetLangCodes.push(LANGUAGE_CODES[lang]);
    }
  }

  // Filter candidates
  const candidates = FALLBACK_CATALOG.filter((movie) => {
    if (excludeSet.has(movie.id)) return false;
    if (movie.runtime > maxMinutes) return false;

    // Family restrictions
    if (isFamily) {
      if (movie.isMature) return false;
      const isKidSafe = movie.genres.includes('Family') || movie.genres.includes('Animation') || movie.genres.includes('Comedy') || movie.genres.includes('Adventure');
      const hasBad = movie.genres.includes('Horror') || movie.genres.includes('Crime') || movie.genres.includes('Thriller');
      if (!isKidSafe || hasBad) return false;
    } else if (!effectiveMature && movie.isMature) {
      return false;
    }

    // Language
    if (targetLangCodes.length > 0 && !targetLangCodes.includes(movie.language)) {
      return false;
    }

    // Highly rated
    if (params.preferences?.highlyRated && movie.rating < 7.0) {
      return false;
    }

    // Recent / Classics
    const currentYear = 2026;
    if (params.preferences?.recent && movie.year < currentYear - 5) {
      return false;
    }
    if (params.preferences?.classics && movie.year >= 2000) {
      return false;
    }

    // Check genre overlap if not pure surprise
    const hasGenreMatch = movie.genres.some((g) => targetGenres.includes(g));
    return hasGenreMatch;
  });

  // Score candidates
  const scored = candidates.map((movie) => {
    let score = movie.rating * 2;
    const matchingGenres = movie.genres.filter((g) => targetGenres.includes(g)).length;
    score += matchingGenres * 3;

    if (params.preferences?.hiddenGems && movie.isHiddenGem) {
      score += 10;
    }
    return { movie, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Ensure 1 hidden gem if available
  let selected: MovieItem[] = [];
  const hiddenGems = scored.filter((s) => s.movie.isHiddenGem);
  const regular = scored.filter((s) => !s.movie.isHiddenGem);

  if (hiddenGems.length > 0) {
    selected.push(hiddenGems[0].movie);
  }

  for (const item of regular) {
    if (selected.length >= 3) break;
    if (!selected.some((m) => m.id === item.movie.id)) {
      selected.push(item.movie);
    }
  }

  // If still under 3, fill from remaining
  for (const item of scored) {
    if (selected.length >= 3) break;
    if (!selected.some((m) => m.id === item.movie.id)) {
      selected.push(item.movie);
    }
  }

  // Fallback: If still under 3 due to strict filters, pick closest from catalog
  if (selected.length < 3) {
    for (const movie of FALLBACK_CATALOG) {
      if (selected.length >= 3) break;
      if (!excludeSet.has(movie.id) && !selected.some((m) => m.id === movie.id)) {
        if (!isFamily || (!movie.isMature && !movie.genres.includes('Horror'))) {
          selected.push(movie);
        }
      }
    }
  }

  // Ensure one item is tagged as hidden gem
  if (selected.length > 0 && !selected.some((m) => m.isHiddenGem)) {
    selected[selected.length - 1].isHiddenGem = true;
  }

  return selected.slice(0, 3).map((m) => ({
    id: m.id,
    title: m.title,
    year: m.year,
    genres: m.genres,
    runtime: m.runtime,
    rating: m.rating,
    overview: m.overview,
    posterUrl: m.posterUrl,
    providers: m.providers,
    reason: generateTemplateReason(m, params.mood, params.audience),
    isHiddenGem: m.isHiddenGem,
  }));
}

/**
 * Generate fallback template reason
 */
export function generateTemplateReason(movie: { title: string; genres: string[] }, mood: string, audience: string): string {
  const genreStr = movie.genres.slice(0, 2).join(' & ');
  if (audience === 'Family with kids') {
    return `A joyful, wholesome ${genreStr.toLowerCase()} that every age in the house will love tonight.`;
  }
  if (audience === 'Partner') {
    return `An atmospheric, engaging ${genreStr.toLowerCase()} pick crafted for a cozy evening for two.`;
  }
  if (audience === 'Friends') {
    return `A high-energy, entertaining ${genreStr.toLowerCase()} that is great to experience together.`;
  }
  switch (mood) {
    case 'Tired':
      return `Light, breezy, and effortlessly entertaining—ideal to unwind without thinking too hard.`;
    case 'Romantic':
      return `Rich in charm and chemistry, perfect for getting lost in a tender, captivating story.`;
    case 'Adventurous':
      return `An exhilarating journey full of momentum, stunning craft, and unforgettable moments.`;
    case 'Curious':
      return `Clever and engrossing, filled with unexpected twists that will keep you guessing.`;
    case 'Sad':
      return `Deeply comforting and heartwarming, offering a gentle lift just when you need it.`;
    case 'Relaxed':
      return `Calm and deeply satisfying, offering a smooth cinematic escape from the daily rush.`;
    case 'Stressed':
      return `Pure escapism and feel-good fun designed to melt away the day's tension.`;
    default:
      return `An uplifting, vibrant watch guaranteed to match your good vibes tonight.`;
  }
}

/**
 * Fetch watch providers from TMDB with in-memory caching
 */
async function fetchWatchProviders(movieId: number, apiKey: string): Promise<{ name: string; logoUrl: string; type?: string }[]> {
  const cacheKey = `${movieId}_${DEFAULT_REGION}`;
  const now = Date.now();
  const cached = providerCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  try {
    const url = `https://api.themoviedb.org/3/movie/${movieId}/watch/providers?api_key=${apiKey}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MovieNightPicker/1.0' } });
    if (!res.ok) return [];

    const json = await res.json();
    const regionData = json.results?.[DEFAULT_REGION] || json.results?.US;
    if (!regionData) {
      providerCache.set(cacheKey, { data: [], expiresAt: now + 3600 * 1000 });
      return [];
    }

    const providers: { name: string; logoUrl: string; type?: string }[] = [];
    const seenNames = new Set<string>();

    if (Array.isArray(regionData.flatrate)) {
      for (const p of regionData.flatrate.slice(0, 4)) {
        if (!seenNames.has(p.provider_name)) {
          seenNames.add(p.provider_name);
          providers.push({
            name: p.provider_name,
            logoUrl: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
            type: 'Stream',
          });
        }
      }
    }

    if (providers.length < 3 && Array.isArray(regionData.rent)) {
      for (const p of regionData.rent.slice(0, 3 - providers.length)) {
        if (!seenNames.has(p.provider_name)) {
          seenNames.add(p.provider_name);
          providers.push({
            name: p.provider_name,
            logoUrl: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
            type: 'Rent',
          });
        }
      }
    }

    if (providers.length < 3 && Array.isArray(regionData.buy)) {
      for (const p of regionData.buy.slice(0, 3 - providers.length)) {
        if (!seenNames.has(p.provider_name)) {
          seenNames.add(p.provider_name);
          providers.push({
            name: p.provider_name,
            logoUrl: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
            type: 'Buy',
          });
        }
      }
    }

    providerCache.set(cacheKey, { data: providers, expiresAt: now + 3600 * 1000 });
    return providers;
  } catch {
    return [];
  }
}

/**
 * Fetch full movie details from TMDB
 */
async function fetchMovieDetails(movieId: number, apiKey: string): Promise<{ runtime: number; genres: string[] } | null> {
  try {
    const url = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${apiKey}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MovieNightPicker/1.0' } });
    if (!res.ok) return null;
    const json = await res.json();
    return {
      runtime: json.runtime || 100,
      genres: Array.isArray(json.genres) ? json.genres.map((g: { name: string }) => g.name) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Call TMDB Discover API
 */
export async function getRecommendationsFromTMDB(params: RecommendParams, apiKey: string): Promise<MoviePick[]> {
  const excludeSet = new Set(params.excludeIds || []);
  const isFamily = params.audience === 'Family with kids';
  const effectiveMature = !isFamily && Boolean(params.preferences?.mature);

  // Genre IDs
  const surpriseMe = params.genres.includes('Surprise me') || params.genres.length === 0;
  const moodGenreNames = MOOD_GENRES[params.mood] || ['Comedy', 'Adventure'];
  const userGenreNames = surpriseMe ? moodGenreNames : params.genres.filter((g) => g !== 'Surprise me');

  const genreIds: number[] = [];
  for (const name of userGenreNames) {
    if (GENRE_MAP[name]) genreIds.push(GENRE_MAP[name]);
  }

  // Query parameters
  const queryParams = new URLSearchParams();
  queryParams.set('api_key', apiKey);
  queryParams.set('sort_by', 'popularity.desc');
  queryParams.set('include_adult', effectiveMature ? 'true' : 'false');

  // Random page 1-3 for variety
  const randomPage = Math.floor(Math.random() * 3) + 1;
  queryParams.set('page', String(randomPage));

  // Rating and vote count
  queryParams.set('vote_average.gte', params.preferences?.highlyRated ? '7.0' : '6.0');
  queryParams.set('vote_count.gte', '100');

  // Runtime
  if (params.maxRuntime === 'Under 90 min') queryParams.set('with_runtime.lte', '90');
  else if (params.maxRuntime === 'Under 2 hours') queryParams.set('with_runtime.lte', '120');
  else if (params.maxRuntime === 'Under 2.5 hours') queryParams.set('with_runtime.lte', '150');

  // Genres with OR pipe
  if (isFamily) {
    queryParams.set('with_genres', '10751|16');
    queryParams.set('without_genres', '27,53,80');
  } else if (genreIds.length > 0) {
    queryParams.set('with_genres', genreIds.join('|'));
  }

  // Languages
  if (params.languages && params.languages.length > 0 && !params.languages.includes('Any')) {
    const langCodes = params.languages.map((l) => LANGUAGE_CODES[l]).filter(Boolean);
    if (langCodes.length > 0) {
      queryParams.set('with_original_language', langCodes.join('|'));
    }
  }

  // Recent / Classics
  const currentYear = 2026;
  if (params.preferences?.recent) {
    queryParams.set('primary_release_date.gte', `${currentYear - 5}-01-01`);
  }
  if (params.preferences?.classics) {
    queryParams.set('primary_release_date.lte', '1999-12-31');
  }

  // Fetch standard discover
  const discoverUrl = `https://api.themoviedb.org/3/discover/movie?${queryParams.toString()}`;
  const discoverRes = await fetch(discoverUrl, { headers: { 'User-Agent': 'MovieNightPicker/1.0' } });
  if (!discoverRes.ok) {
    throw new Error('TMDB discover error');
  }
  const discoverData = await discoverRes.json();
  const rawResults: any[] = Array.isArray(discoverData.results) ? discoverData.results : [];

  // Filter out excludes and movies without posters
  const validMovies = rawResults.filter((m: any) => !excludeSet.has(m.id) && m.poster_path);

  if (validMovies.length === 0) {
    return filterFallbackCatalog(params);
  }

  // Split into candidates and look for hidden gems (lower popularity, vote_average >= 7)
  const hiddenGemCandidates = validMovies.filter((m: any) => m.vote_average >= 7.0 && m.vote_count >= 100 && m.vote_count <= 2500);
  const popularCandidates = validMovies.filter((m: any) => !hiddenGemCandidates.some((hg) => hg.id === m.id));

  const chosen: { movie: any; isHiddenGem: boolean }[] = [];

  // Pick 1 hidden gem
  if (hiddenGemCandidates.length > 0) {
    chosen.push({ movie: hiddenGemCandidates[0], isHiddenGem: true });
  }

  // Fill up to 3 from popular candidates
  for (const m of popularCandidates) {
    if (chosen.length >= 3) break;
    chosen.push({ movie: m, isHiddenGem: false });
  }

  // If still under 3, fill from any remaining
  for (const m of validMovies) {
    if (chosen.length >= 3) break;
    if (!chosen.some((c) => c.movie.id === m.id)) {
      chosen.push({ movie: m, isHiddenGem: chosen.length === 0 });
    }
  }

  // Parallel fetch movie details and watch providers
  const enrichedPromises = chosen.slice(0, 3).map(async ({ movie, isHiddenGem }) => {
    const [details, providers] = await Promise.all([
      fetchMovieDetails(movie.id, apiKey),
      fetchWatchProviders(movie.id, apiKey),
    ]);

    const genreNames = details?.genres && details.genres.length > 0
      ? details.genres
      : userGenreNames.slice(0, 3);

    const year = movie.release_date ? parseInt(movie.release_date.split('-')[0], 10) : 2020;
    const runtime = details?.runtime || 105;

    return {
      id: movie.id,
      title: movie.title,
      year: isNaN(year) ? 2022 : year,
      genres: genreNames,
      runtime,
      rating: parseFloat((movie.vote_average || 7.0).toFixed(1)),
      overview: movie.overview || 'A captivating film matched to your evening vibe.',
      posterUrl: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
      providers,
      reason: generateTemplateReason({ title: movie.title, genres: genreNames }, params.mood, params.audience),
      isHiddenGem,
    };
  });

  const finalPicks = await Promise.all(enrichedPromises);
  // Ensure at least one hidden gem tag is active
  if (!finalPicks.some((p) => p.isHiddenGem) && finalPicks.length > 0) {
    finalPicks[finalPicks.length - 1].isHiddenGem = true;
  }

  return finalPicks;
}
