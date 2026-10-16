/**
 * Idempotent schema migration. Usage: npm run db:migrate
 * Safe to run twice; CREATE TABLE / INDEX IF NOT EXISTS throughout.
 */
import { dbQuery, isDbConfigured } from '../server/db.js';

export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS movies (
  tmdbId INTEGER PRIMARY KEY,
  imdbId TEXT,
  title TEXT NOT NULL,
  originalTitle TEXT,
  year INTEGER,
  runtime INTEGER,
  genres TEXT[] NOT NULL DEFAULT '{}',
  originalLanguage TEXT,
  spokenLanguages TEXT[] NOT NULL DEFAULT '{}',
  overview TEXT,
  rating DOUBLE PRECISION,
  votes INTEGER,
  popularity DOUBLE PRECISION,
  posterPath TEXT,
  certificate TEXT,
  minAge INTEGER,
  adult BOOLEAN NOT NULL DEFAULT FALSE,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  productionCountries TEXT[] NOT NULL DEFAULT '{}',
  updatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS movies_year_idx ON movies (year);
CREATE INDEX IF NOT EXISTS movies_runtime_idx ON movies (runtime);
CREATE INDEX IF NOT EXISTS movies_lang_idx ON movies (originalLanguage);
CREATE INDEX IF NOT EXISTS movies_genres_gin ON movies USING GIN (genres);
CREATE INDEX IF NOT EXISTS movies_minage_idx ON movies (minAge);
CREATE INDEX IF NOT EXISTS movies_rating_idx ON movies (rating);
ALTER TABLE movies ADD COLUMN IF NOT EXISTS certByCountry JSONB;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS minAgeStrict INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS adultVotes INTEGER;
`;

if (!isDbConfigured()) {
  console.log('DATABASE_URL is not set. NOT RUN: create a Neon database, set DATABASE_URL, re-run npm run db:migrate.');
  process.exit(3);
}
await dbQuery(MIGRATION_SQL);
console.log('migration ok: movies table + 6 indexes');
