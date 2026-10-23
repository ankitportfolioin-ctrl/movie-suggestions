/**
 * Shared Postgres pool (Neon). One helper for server routes and scripts.
 *
 * Reads DATABASE_URL from env (name only; never log the value). For Neon the
 * URL must include ?sslmode=require — pg honors it, so no code branching.
 */
import { Pool } from 'pg';

let pool: Pool | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    // D15: same capped waits as the dbMovies pool — a dead serverless
    // connection otherwise hangs on the OS TCP timeout (~20s).
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      // Neon closes idle sockets and scales to zero; recycle idle clients quickly and
      // keep TCP alive so a reused serverless connection is never silently dead.
      idleTimeoutMillis: 10_000,
      keepAlive: true,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 5000,
    });
  }
  return pool;
}

// shortcut: returns rows only; callers needing rowCount use getPool() directly.
export async function dbQuery<T>(text: string, params?: unknown[]): Promise<T[]> {
  const { rows } = await getPool().query(text, params as unknown[]);
  return rows as T[];
}
