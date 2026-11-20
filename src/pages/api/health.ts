import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/client';

/** Liveness + DB readiness probe (Railway healthcheckPath). */
export const GET: APIRoute = async () => {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
};
