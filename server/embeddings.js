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
  // shortcut: file lock can fail on read-only serverless FS; treat as empty cache, upgrade to KV/store if persistence needed.
  let release;
  try {
    release = await lockfile.lock(EMBEDDINGS_FILE, { retries: 3, retryWait: 50, stale: 5000 });
  } catch {
    return { model: MODEL_NAME, movies: [] };
  }
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
 * Append new embedding entries, merging with whatever is currently on disk
 * under a single lock acquisition. Closes the lost-update window where two
 * concurrent generators both read, both compute, and the slower save wipes
 * the faster one's entries.
 */
async function appendEmbeddings(newEntries) {
  // shortcut: single lock covers load-merge-write; generation itself stays outside
  // the lock (minutes-long python calls must never hold a file lock). Upgrade to a
  // job queue if exactly-once generation (not just exactly-once persistence) is required.
  const release = await lockfile.lock(EMBEDDINGS_FILE, { retries: 10, retryWait: 100, stale: 10000 });
  try {
    let data;
    try {
      data = existsSync(EMBEDDINGS_FILE)
        ? JSON.parse(readFileSync(EMBEDDINGS_FILE, 'utf-8'))
        : { model: MODEL_NAME, movies: [] };
      if (!Array.isArray(data.movies)) data.movies = [];
    } catch {
      data = { model: MODEL_NAME, movies: [] };
    }
    const ids = new Set(data.movies.map((m) => m.id));
    let added = 0;
    for (const e of newEntries) {
      if (!ids.has(e.id)) {
        data.movies.push(e);
        ids.add(e.id);
        added++;
      }
    }
    writeFileSync(EMBEDDINGS_FILE, JSON.stringify(data, null, 2));
    return added;
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

  const newEntries = [];
  for (const movie of newMovies) {
    const embedding = await generateEmbedding(movie);
    if (embedding) {
      newEntries.push({
        id: movie.id,
        title: movie.title,
        year: movie.year,
        embedding,
      });
      existingIds.add(movie.id);
    } else {
      console.warn(`[embeddings] Failed to generate embedding for "${movie.title}" (id: ${movie.id})`);
    }
  }

  if (newEntries.length === 0) return 0;
  // shortcut: throws on read-only serverless FS; caller must catch. Upgrade to KV/store if persistence needed.
  const added = await appendEmbeddings(newEntries);
  console.log(`[embeddings] Saved ${added} new embeddings to ${EMBEDDINGS_FILE}`);
  return added;
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