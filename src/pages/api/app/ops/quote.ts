/**
 * Live availability + price for the manual booking builder.
 * POST JSON { day, startHour, endHour, overnight?, lines:[{itemId,qty}], zip, surface?, damageWaiver?, coupon? }
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { availability, priceCart, ruleMessage } from '../../../../lib/booking';

const Body = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(24),
  overnight: z.boolean().optional(),
  lines: z.array(z.object({ itemId: z.uuid(), qty: z.number().int().min(1).max(50) })).max(40).default([]),
  zip: z.string().max(10).default(''),
  surface: z.string().max(40).optional(),
  damageWaiver: z.boolean().optional(),
  coupon: z.string().max(40).optional(),
  excludeBookingId: z.uuid().optional(),
});

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ locals, request }) => {
  const s = locals.session;
  if (!s?.tenant || s.role === 'crew') return json({ error: 'forbidden' }, 403);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const r = Body.safeParse(raw);
  if (!r.success) return json({ error: 'invalid', issues: r.error.issues.slice(0, 3) }, 400);
  const d = r.data;
  const t = s.tenant;
  const window = { day: d.day, startHour: d.startHour, endHour: d.endHour, overnight: d.overnight };
  const rules = await availability(t, window, { excludeBookingId: d.excludeBookingId });
  const av = rules.ok ? rules : await availability(t, window, { skipRules: true, excludeBookingId: d.excludeBookingId });
  const priced = d.lines.length ? await priceCart(t, { window, lines: d.lines, zip: d.zip, surface: d.surface, damageWaiver: d.damageWaiver, couponCode: d.coupon || null }, { excludeBookingId: d.excludeBookingId }) : null;
  return json({
    free: av.free,
    rule: rules.ok ? null : { reason: rules.reason, message: ruleMessage(rules.reason) },
    window: { startsAt: av.window.startsAt, endsAt: av.window.endsAt, hours: av.window.hours },
    priced: priced && {
      quote: priced.quote, zone: priced.zone, deliverable: priced.deliverable, belowMinimum: priced.belowMinimum,
      conflicts: priced.conflicts, coupon: priced.coupon ? { code: priced.coupon.code } : null,
    },
  });
};
