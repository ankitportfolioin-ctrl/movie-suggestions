#!/usr/bin/env tsx
/**
 * Local SQLite movie index for CineMatch.
 * Schema: imdbId, title, year, runtime, genres, originalLanguage, certificate, rating, votes, overview, keywords, cast, director, tone scores.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_DIR = join(__dirname, '..', 'data');
const DB_PATH = join(DB_DIR, 'movies.db');

mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

console.log('🗄️  Creating movie table schema...');

// Create movies table
db.exec(`
  CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imdb_id TEXT UNIQUE NOT NULL,           -- e.g., 'tt0114709'
    tmdb_id INTEGER,                         -- TMDB movie ID
    title TEXT NOT NULL,
    original_title TEXT,
    year INTEGER NOT NULL,
    runtime INTEGER,                         -- minutes
    genres TEXT NOT NULL,                    -- JSON array of genre strings
    original_language TEXT NOT NULL,         -- ISO 639-1 code
    certificate TEXT,                        -- MPAA/BBFC rating (R, PG-13, etc.)
    rating REAL,                             -- 0-10 (IMDb/TMDB)
    votes INTEGER,                           -- vote count
    popularity REAL,                         -- TMDB popularity
    overview TEXT,                           -- plot synopsis
    keywords TEXT,                           -- JSON array of keyword strings
    cast TEXT,                               -- JSON array of cast names (top 10)
    director TEXT,                           -- director name(s)
    -- Tone scores (0-1 each, computed offline)
    tone_energy REAL DEFAULT 0.5,            -- high = action-packed, fast-paced
    tone_darkness REAL DEFAULT 0.5,          -- high = grim, bleak, violent
    tone_humor REAL DEFAULT 0.5,             -- high = funny, comedic
    tone_emotional_weight REAL DEFAULT 0.5,  -- high = heavy drama, tearjerker
    tone_complexity REAL DEFAULT 0.5,        -- high = mind-bending, non-linear
    -- Embeddings
    embedding TEXT,                          -- JSON array of floats (overview+keywords+genres)
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
  
  CREATE INDEX IF NOT EXISTS idx_movies_imdb_id ON movies(imdb_id);
  CREATE INDEX IF NOT EXISTS idx_movies_tmdb_id ON movies(tmdb_id);
  CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year);
  CREATE INDEX IF NOT EXISTS idx_movies_language ON movies(original_language);
  CREATE INDEX IF NOT EXISTS idx_movies_rating ON movies(rating);
  CREATE INDEX IF NOT EXISTS idx_movies_certificate ON movies(certificate);
  CREATE INDEX IF NOT EXISTS idx_movies_runtime ON movies(runtime);
  CREATE INDEX IF NOT EXISTS idx_movies_genres ON movies(genres);
`);

console.log('✅ Schema created');

// Prepare statements
const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO movies (
    imdb_id, tmdb_id, title, original_title, year, runtime, genres,
    original_language, certificate, rating, votes, popularity, overview,
    keywords, cast, director,
    tone_energy, tone_darkness, tone_humor, tone_emotional_weight, tone_complexity,
    embedding, updated_at
  ) VALUES (
    @imdb_id, @tmdb_id, @title, @original_title, @year, @runtime, @genres,
    @original_language, @certificate, @rating, @votes, @popularity, @overview,
    @keywords, @cast, @director,
    @tone_energy, @tone_darkness, @tone_humor, @tone_emotional_weight, @tone_complexity,
    @embedding, strftime('%s', 'now')
  )
`);

const selectByImdb = db.prepare('SELECT * FROM movies WHERE imdb_id = ?');
const selectAll = db.prepare('SELECT * FROM movies');
const countStmt = db.prepare('SELECT COUNT(*) as count FROM movies');

export { db, insertStmt, selectByImdb, selectAll, countStmt, DB_PATH };