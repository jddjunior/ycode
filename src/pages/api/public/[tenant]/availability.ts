/**
 * GET /api/public/{tenant}/availability?day=YYYY-MM-DD&start=10&end=18&zip=77008
 * → free units per item, the booking-rule reason (if any) and the delivery
 *   zone/fee for the ZIP, so shoppers see real availability + fees up front.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { availability, ruleMessage } from '../../../../lib/booking';
import { loadInventory } from '../../../../lib/booking';
import { getDb } from '../../../../db/client';
import { json, publicTenant, zDay, zHour, zodError } from '../../../../lib/site/api';
import { zoneForZip } from '../../../../lib/site/data';

const Q = z.object({
  day: zDay,
  start: zHour.optional(),
  end: zHour.optional(),
  zip: z.string().trim().regex(/^\d{5}$/).optional().or(z.literal('').transform(() => undefined)),
});

export const GET: APIRoute = async (ctx) => {
  const r = await publicTenant(ctx, 'avail', 120, 120);
  if (r instanceof Response) return r;
  const { t } = r;
  const p = Q.safeParse(Object.fromEntries(ctx.url.searchParams));
  if (!p.success) return zodError(p.error);
  const s = t.settings ?? {};
  const startHour = p.data.start ?? s.defaultStartHour ?? 10;
  let endHour = p.data.end ?? s.defaultEndHour ?? 18;
  if (endHour <= startHour) endHour = Math.min(24, startHour + 6);

  const [av, inv, zone] = await Promise.all([
    availability(t, { day: p.data.day, startHour, endHour }),
    loadInventory(await getDb(), t.id),
    p.data.zip ? zoneForZip(t, p.data.zip) : Promise.resolve(null),
  ]);
  const items = inv.filter((i) => i.active).map((i) => ({
    id: i.id, slug: i.slug, kind: i.kind, quantity: i.quantity,
    free: av.ok ? Math.max(0, av.free[i.id] ?? 0) : 0,
  }));
  const available = items.filter((i) => i.kind !== 'addon' && i.free > 0).length;
  return json({
    ok: av.ok, reason: av.reason ?? null, message: av.ok ? null : ruleMessage(av.reason),
    day: p.data.day, startHour, endHour, hours: av.window.hours,
    available, items, zone,
  }, 200, { 'cache-control': 'private, max-age=15' });
};
