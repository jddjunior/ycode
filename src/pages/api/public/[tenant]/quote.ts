/**
 * POST /api/public/{tenant}/quote  { window, lines, zip, surface?, damageWaiver?, couponCode? }
 * → server-side price breakdown (never trust client prices).
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { priceCart } from '../../../../lib/booking';
import { loadInventory } from '../../../../lib/booking';
import { getDb } from '../../../../db/client';
import { bookingErrorResponse, cleanLines, json, publicTenant, readJson, zLines, zWindow, zodError, apiError } from '../../../../lib/site/api';
import { zoneForZip } from '../../../../lib/site/data';

const Body = z.object({
  window: zWindow,
  lines: zLines,
  zip: z.string().trim().regex(/^\d{5}$/, 'Enter a 5-digit ZIP'),
  surface: z.string().max(40).optional(),
  damageWaiver: z.boolean().optional(),
  couponCode: z.string().trim().max(40).optional().nullable(),
});

export const POST: APIRoute = async (ctx) => {
  const r = await publicTenant(ctx, 'quote', 60, 60);
  if (r instanceof Response) return r;
  const { t } = r;
  let raw: unknown;
  try { raw = await readJson(ctx.request); } catch { return apiError(400, 'bad_json', 'Invalid request.'); }
  const p = Body.safeParse(raw);
  if (!p.success) return zodError(p.error);
  try {
    const inv = await loadInventory(await getDb(), t.id);
    const active = inv.filter((i) => i.active);
    const lines = cleanLines(p.data.lines, new Set(active.map((i) => i.id)));
    const priced = await priceCart(t, { ...p.data, lines, couponCode: p.data.couponCode || null });
    const zone = await zoneForZip(t, p.data.zip);
    const q = priced.quote;
    return json({
      ok: true,
      lines: q.lines,
      subtotalCents: q.subtotalCents, deliveryCents: q.deliveryCents, surfaceCents: q.surfaceCents,
      damageWaiverCents: q.damageWaiverCents, discountCents: q.discountCents, taxCents: q.taxCents,
      customerFeeCents: q.customerFeeCents, totalCents: q.totalCents, depositCents: q.depositCents,
      balanceCents: q.totalCents - q.depositCents,
      zone: priced.zone, deliverable: priced.deliverable, belowMinimum: priced.belowMinimum, minOrderCents: zone.minOrderCents,
      conflicts: priced.conflicts,
      coupon: priced.coupon ? { code: priced.coupon.code } : null,
      couponInvalid: !!p.data.couponCode && !priced.coupon,
      hours: priced.window.hours,
    });
  } catch (e) {
    return bookingErrorResponse(e);
  }
};
