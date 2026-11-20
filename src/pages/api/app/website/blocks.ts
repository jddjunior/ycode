/**
 * Save a page's blocks from the BlockEditor island.
 * POST application/json { pageId, blocks } → { ok, blocks }
 * Tenant-scoped; blocks are zod-validated per type with size caps.
 */
import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../../../../db/client';
import { validateBlocks } from '../../../../lib/growth/blocks';
import { LIMITS } from '../../../../lib/growth/blockdefs';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const Body = z.object({ pageId: z.uuid(), blocks: z.array(z.unknown()).max(LIMITS.blocks) });

export const POST: APIRoute = async ({ request, locals, url }) => {
  const tenant = locals.session?.tenant;
  if (!tenant) return json({ error: 'unauthorized' }, 401);
  if (locals.session?.role === 'crew') return json({ error: 'forbidden' }, 403);
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return json({ error: 'expected application/json' }, 415);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'bad origin' }, 403);
  const raw = await request.text();
  if (raw.length > LIMITS.bytes * 2) return json({ error: 'payload too large' }, 413);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return json({ error: 'invalid JSON' }, 400); }
  const b = Body.safeParse(data);
  if (!b.success) return json({ error: b.error.issues[0]?.message ?? 'invalid body' }, 400);
  const v = validateBlocks(b.data.blocks);
  if (!v.ok) return json({ error: v.error }, 422);

  const db = await getDb();
  const [row] = await db.update(schema.pages).set({ blocks: v.blocks, updatedAt: new Date() })
    .where(and(eq(schema.pages.id, b.data.pageId), eq(schema.pages.tenantId, tenant.id))).returning({ id: schema.pages.id });
  if (!row) return json({ error: 'page not found' }, 404);
  return json({ ok: true, blocks: v.blocks });
};
