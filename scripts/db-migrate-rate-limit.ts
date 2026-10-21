/**
 * Creates the rate_limits counter table (see server/rateLimit.ts).
 * Usage: npm run db:migrate:rate-limit. Idempotent.
 * Loads .env so the npm script works without exporting DATABASE_URL by hand.
 */
import 'dotenv/config';
import { dbQuery, isDbConfigured } from '../server/db.js';

export const RATE_LIMIT_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_id BIGINT NOT NULL,
  count INTEGER NOT NULL
);
-- window_id is derived from wall-clock (floor(now / windowMs)); old windows
-- are never updated again, so rows wide instead of deep — periodic cleanup:
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_id);
`;

if (!isDbConfigured()) {
  console.log(
    'DATABASE_URL is not set. NOT RUN: create a database, set DATABASE_URL, re-run npm run db:migrate:rate-limit.',
  );
  process.exit(3);
}
await dbQuery(RATE_LIMIT_MIGRATION_SQL);
console.log('migration ok: rate_limits table + index');
