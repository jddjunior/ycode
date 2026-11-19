/** GET /api/app/ads/{id}.csv — Google Ads Editor import file for a campaign (tenant-scoped). */
import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../../../../db/client';
import { googleAdsEditorCsv } from '../../../../lib/growth/ads';
import { slugify } from '../../../../lib/util';

export const GET: APIRoute = async ({ params, locals }) => {
  const tenant = locals.session?.tenant;
  if (!tenant) return new Response('unauthorized', { status: 401 });
  const id = params.id ?? '';
  if (!z.uuid().safeParse(id).success) return new Response('not found', { status: 404 });
  const db = await getDb();
  const [c] = await db.select().from(schema.adCampaigns).where(and(eq(schema.adCampaigns.id, id), eq(schema.adCampaigns.tenantId, tenant.id))).limit(1);
  if (!c) return new Response('not found', { status: 404 });
  if (c.network !== 'google') return new Response('CSV export is for Google Search campaigns', { status: 400 });
  return new Response(googleAdsEditorCsv(c), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${slugify(c.name)}-google-ads-editor.csv"`,
      'cache-control': 'private, no-store',
    },
  });
};
