/**
 * Embedding generation utility for dynamically discovered TMDB movies.
 * Uses the same SentenceTransformer model as the semantic search module.
 * Appends new embeddings to data/movie-embeddings.json (idempotent, concurrency-safe).
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import lockfile from 'proper-lockfile';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EMBEDDINGS_FILE = resolve(__dirname, '..', 'data', 'movie-embeddings.json');
const MODEL_NAME = 'all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

const PYTHON_CODE = `
import sys
import json
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
embedding = model.encode(sys.argv[1])
print(json.dumps(embedding.tolist()))
sys.exit(0)
`.trim();

/**
 * Generate embedding for a single movie via Python subprocess.
 * Returns Promise<float32[]> or null on failure.
 */
export async function generateEmbedding(movie) {
  const text = buildMovieText(movie);
  if (!text) return null;

  return new Promise((resolve) => {
    const pythonProcess = spawn('python3', ['-c', PYTHON_CODE, text]);

    let stdoutData = '';
    pythonProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
    pythonProcess.on('close', (code) => {
      if (code === 0 && stdoutData) {
        try {
          const embedding = JSON.parse(stdoutData);
          if (Array.isArray(embedding) && embedding.length === EMBEDDING_DIM) {
            resolve(embedding);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
    pythonProcess.on('error', () => resolve(null));
  });
}

/**
 * Build text representation for embedding (same as semantic.js buildMovieText).
 */
export function buildMovieText(movie) {
  const parts = [movie.title, movie.overview, movie.genres.join(' ')]
    .filter((p) => p && p.length > 0)
    .join(' [SEP] ');
  return parts;
}

/**
 * Load current embeddings file (with shared lock for concurrent reads).
 */
async function loadEmbeddings() {
  const release = await lockfile.lock(EMBEDDINGS_FILE, { retries: 3, retryWait: 50, stale: 5000 });
  try {
    try {
      if (!existsSync(EMBEDDINGS_FILE)) return { model: MODEL_NAME, movies: [] };
      const data = JSON.parse(readFileSync(EMBEDDINGS_FILE, 'utf-8'));
      return { model: data.model || MODEL_NAME, movies: data.movies || [] };
    } catch {
      return { model: MODEL_NAME, movies: [] };
    }
  } finally {
    await release();
  }
}

/**
 * Save embeddings to file (with exclusive lock for concurrent writes).
 */
async function saveEmbeddings(data) {
  const release = await lockfile.lock(EMBEDDINGS_FILE, { retries: 3, retryWait: 50, stale: 5000 });
  try {
    writeFileSync(EMBEDDINGS_FILE, JSON.stringify(data, null, 2));
  } finally {
    await release();
  }
}

/**
 * Generate and cache embeddings for TMDB movies that don't have them.
 * Idempotent: skips movies that already have embeddings (by TMDB id).
 * Concurrency-safe: uses file locking for cache reads/writes.
 * Returns count of newly generated embeddings.
 */
export async function generateEmbeddingsForMovies(movies) {
  const data = await loadEmbeddings();
  const existingIds = new Set(data.movies.map((m) => m.id));
  const newMovies = movies.filter((m) => m.id && !existingIds.has(m.id));

  if (newMovies.length === 0) return 0;

  console.log(`[embeddings] Generating embeddings for ${newMovies.length} new TMDB movies...`);

  let generated = 0;
  for (const movie of newMovies) {
    const embedding = await generateEmbedding(movie);
    if (embedding) {
      data.movies.push({
        id: movie.id,
        title: movie.title,
        year: movie.year,
        embedding,
      });
      generated++;
      existingIds.add(movie.id);
    } else {
      console.warn(`[embeddings] Failed to generate embedding for "${movie.title}" (id: ${movie.id})`);
    }
  }

  if (generated > 0) {
    await saveEmbeddings(data);
    console.log(`[embeddings] Saved ${generated} new embeddings to ${EMBEDDINGS_FILE}`);
  }
  return generated;
}

/**
 * Refresh the embeddings cache by reloading from file (shared lock).
 * Call this after generating new embeddings to make them available.
 */
export async function refreshEmbeddingsCache() {
  const data = await loadEmbeddings();
  return data.movies;
}

export { loadEmbeddings, EMBEDDING_DIM, MODEL_NAME };