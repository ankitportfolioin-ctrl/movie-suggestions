import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

// Load .env the same way server.ts does, so the DB gate reflects the real env;
// keys present in .env were invisible to the npm test command before this.
const hasDb = Boolean(process.env.DATABASE_URL);

describe('postgres index', { skip: !hasDb || undefined }, () => {
  test('migration is idempotent (runs twice)', async () => {
    const { MIGRATION_SQL } = await import('../scripts/db-migrate.js');
    const { dbQuery } = await import('../server/db.js');
    await dbQuery(MIGRATION_SQL);
    await dbQuery(MIGRATION_SQL);
    const rows = await dbQuery<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE tablename='movies'"
    );
    assert.equal(rows.length, 1);
    const cols = await dbQuery<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='movies'"
    );
    for (const c of ['certbycountry', 'minagestrict', 'adultvotes']) {
      assert.ok(cols.some((r) => r.column_name === c), `missing column ${c}`);
    }
  });

  test('backfill UPDATE matches the row pg returns (lowercase tmdbid)', async () => {
    const { upsertMovies } = await import('../scripts/load-movies-json.js');
    const { updateCertBatch, pgIds } = await import('../scripts/ingest-tmdb.mjs');
    const { dbQuery, getPool } = await import('../server/db.js');
    await upsertMovies([
      { tmdbId: -3, title: 'Backfill Test Film', year: 2001, runtime: 90, genres: ['Comedy'], originalLanguage: 'en', overview: 't', rating: 7, votes: 5 },
    ]);
    await dbQuery('UPDATE movies SET minAge = NULL WHERE tmdbId = -3');
    // Same round-trip as runBackfill: ids come from pg rows, certs go back in.
    const { rows } = await getPool().query('SELECT tmdbId FROM movies WHERE tmdbId = -3');
    const n = await updateCertBatch(getPool(),
      pgIds(rows).map((tmdbId: number) => ({ tmdbId, certificate: 'PG', minAge: 6 })));
    assert.equal(n, 1);
    const [row] = await dbQuery<{ minage: number }>('SELECT minAge FROM movies WHERE tmdbId = -3');
    assert.equal(row.minage, 6);
    await dbQuery('DELETE FROM movies WHERE tmdbId = -3');
  });

  test('upserting the same rows twice creates no duplicates', async () => {
    const { upsertMovies } = await import('../scripts/load-movies-json.js');
    const { dbQuery } = await import('../server/db.js');
    const sample = [
      { tmdbId: -1, title: 'Db Test Film', year: 2001, runtime: 90, genres: ['Comedy'], originalLanguage: 'en', overview: 't', rating: 7, votes: 5 },
      { tmdbId: -2, title: 'Db Test Film 2', year: 2002, runtime: 95, genres: ['Drama'], originalLanguage: 'hi', overview: 't', rating: 6, votes: 5 },
    ];
    await upsertMovies(sample);
    const c1 = await dbQuery<{ count: string }>('SELECT count(*) FROM movies WHERE tmdbId IN (-1,-2)');
    await upsertMovies(sample);
    const c2 = await dbQuery<{ count: string }>('SELECT count(*) FROM movies WHERE tmdbId IN (-1,-2)');
    assert.equal(c1[0].count, '2');
    assert.equal(c2[0].count, '2');
    await dbQuery('DELETE FROM movies WHERE tmdbId IN (-1,-2)');
  });
});
