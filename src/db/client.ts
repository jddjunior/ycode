/**
 * Database client.
 *  - Production: DATABASE_URL → postgres-js (Railway Postgres / any PG 15+).
 *  - Local/dev/test: embedded PGlite (real Postgres compiled to WASM) at PGLITE_DIR
 *    (default ./.data/pglite), or in-memory when PGLITE_DIR=memory.
 */
import * as schema from './schema';
import type { PgDatabase } from 'drizzle-orm/pg-core';

export type DB = PgDatabase<any, typeof schema>;

let dbPromise: Promise<DB> | null = null;

async function create(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const client = postgres(url, {
      max: Number(process.env.DB_POOL_MAX ?? 10),
      ssl: process.env.DATABASE_SSL === 'disable' ? false : url.includes('localhost') || url.includes('.railway.internal') ? false : 'require',
      prepare: false,
    });
    const db = drizzle(client, { schema }) as unknown as DB;
    // drizzle swaps postgres-js's date serializers for pass-throughs, so a raw JS Date
    // inside an sql`` template would be sent as Date.toString() and rejected by Postgres.
    // Serialize Dates to ISO-8601 for every timestamp/date type (strings pass unchanged).
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
    for (const oid of ['1082', '1083', '1114', '1184', '1266']) {
      (client.options.serializers as Record<string, (v: unknown) => unknown>)[oid] = iso;
    }
    return db;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const dir = process.env.PGLITE_DIR ?? './.data/pglite';
  if (dir !== 'memory') (await import('node:fs')).mkdirSync(dir, { recursive: true });
  const client = dir === 'memory' ? new PGlite() : new PGlite(dir);
  await client.waitReady;
  return drizzle(client, { schema }) as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (!dbPromise) dbPromise = create().then(async (db) => {
    if (process.env.AUTO_MIGRATE !== 'false') {
      const { migrate } = await import('./migrate');
      await migrate(db);
    }
    return db;
  });
  return dbPromise;
}

/** Test helper: drop the cached connection. */
export function resetDbForTests() { dbPromise = null; }

export { schema };
