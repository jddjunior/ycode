/**
 * POST /api/public/{tenant}/lead
 *  - JSON from checkout once contact details are entered → abandoned-cart lead
 *    (upserted by leadId so each shopper is one lead).
 *  - Form POST from the contact/quote block → quote request, then 303 back.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../db/client';
import { apiError, json, publicTenant, readJson, zLines, zodError } from '../../../../lib/site/api';
import { readAttribution } from '../../../../lib/site/attribution';

const Body = z.object({
  leadId: z.string().uuid().optional().nullable(),
  name: z.string().trim().max(120).default(''),
  email: z.union([z.string().trim().email('Enter a valid email').max(200), z.literal('')]).default(''),
  phone: z.string().trim().max(40).default(''),
  eventDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().nullable(),
  zip: z.string().trim().max(10).default(''),
  message: z.string().trim().max(4000).default(''),
  cart: zLines.default([]),
  source: z.enum(['abandoned_checkout', 'quote_form']).default('quote_form'),
  website: z.string().max(200).optional(), // honeypot
  return: z.string().max(300).optional(),
}).refine((b) => b.email || b.phone.replace(/\D/g, '').length >= 7, { message: 'Add an email or phone number so we can reply', path: ['email'] });

export const POST: APIRoute = async (ctx) => {
  const r = await publicTenant(ctx, 'lead', 12, 6);
  if (r instanceof Response) return r;
  const { t } = r;
  const isForm = (ctx.request.headers.get('content-type') ?? '').includes('form');
  let raw: unknown;
  try { raw = await readJson(ctx.request); } catch { return apiError(400, 'bad_json', 'Invalid request.'); }
  const back = (q: string) => {
    const ret = typeof (raw as { return?: unknown })?.return === 'string' ? (raw as { return: string }).return : '/';
    const safe = /^\/(?!\/)[\w\-./]*$/.test(ret) ? ret : '/';
    return ctx.redirect(`${safe}?${q}#contact`, 303);
  };
  const p = Body.safeParse(raw);
  if (!p.success) {
    if (isForm) return back('error=' + encodeURIComponent(p.error.issues[0]?.message ?? 'Please check the form'));
    return zodError(p.error);
  }
  const d = p.data;
  if (d.website) return isForm ? back('sent=1') : json({ ok: true, leadId: null }); // bot
  const db = await getDb();
  const values = {
    name: d.name, email: d.email, phone: d.phone, eventDate: d.eventDate || null, zip: d.zip.slice(0, 5),
    message: d.message, cart: d.cart, source: d.source,
  };
  let leadId: string | null = null;
  if (d.leadId) {
    const [u] = await db.update(schema.leads).set(values)
      .where(and(eq(schema.leads.id, d.leadId), eq(schema.leads.tenantId, t.id), eq(schema.leads.stage, 'new'))).returning({ id: schema.leads.id });
    leadId = u?.id ?? null;
  }
  if (!leadId) {
    const [n] = await db.insert(schema.leads).values({ tenantId: t.id, ...values, attribution: readAttribution(ctx.cookies) }).returning({ id: schema.leads.id });
    leadId = n.id;
    await db.insert(schema.activity).values({
      tenantId: t.id, kind: d.source === 'quote_form' ? 'lead' : 'cart',
      message: d.source === 'quote_form' ? `New quote request from ${d.name || d.email || d.phone}` : `${d.name || 'A shopper'} started checkout${d.eventDate ? ` for ${d.eventDate}` : ''}`,
      data: { leadId },
    });
  }
  return isForm ? back('sent=1') : json({ ok: true, leadId });
};
