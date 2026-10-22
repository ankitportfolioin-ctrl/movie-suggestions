/**
 * Discovery-feature schema (idempotent): pg_trgm typo-tolerant title search and
 * the keyword rarity table behind "more like this". Re-run after every catalog
 * ingest so keyword_df matches the data. Usage: npm run db:migrate:discovery
 */
import 'dotenv/config';
import { dbQuery, isDbConfigured } from '../server/db.js';

if (!isDbConfigured()) {
  console.log('DATABASE_URL is not set. NOT RUN.');
  process.exit(3);
}
await dbQuery('CREATE EXTENSION IF NOT EXISTS pg_trgm');
await dbQuery('CREATE INDEX IF NOT EXISTS movies_title_trgm ON movies USING gin (lower(title) gin_trgm_ops)');
await dbQuery('CREATE TABLE IF NOT EXISTS keyword_df (k TEXT PRIMARY KEY, df INTEGER NOT NULL)');
await dbQuery('TRUNCATE keyword_df');
await dbQuery('INSERT INTO keyword_df SELECT k, count(*) FROM movies, unnest(keywords) AS k GROUP BY k');
console.log('migration ok: pg_trgm + title trigram index + keyword_df');
