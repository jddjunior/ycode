/**
 * POST /api/public/{tenant}/book
 * Creates a short-lived HOLD (advisory-locked, re-priced server side) with the
 * e-signed agreement + first-party attribution, then starts checkout for the
 * deposit and returns the payment URL (Stripe, or a signed demo link).
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../db/client';
import { createBooking, loadInventory } from '../../../../lib/booking';
import { createCheckout } from '../../../../lib/payments';
import { siteOrigin } from '../../../../lib/tenant';
import { apiError, bookingErrorResponse, cleanLines, json, publicTenant, readJson, zLines, zWindow, zZip, zodError } from '../../../../lib/site/api';
import { readAttribution } from '../../../../lib/site/attribution';
import { agreementText } from '../../../../lib/site/data';

const Body = z.object({
  window: zWindow,
  lines: zLines.min(1, 'Your cart is empty'),
  zip: zZip,
  surface: z.string().trim().max(40).default('grass'),
  damageWaiver: z.boolean().default(false),
  couponCode: z.string().trim().max(40).optional().nullable(),
  customer: z.object({
    name: z.string().trim().min(2, 'Enter your name').max(120),
    email: z.email('Enter a valid email').max(200),
    phone: z.string().trim().refine((v) => v.replace(/\D/g, '').length >= 10, 'Enter a mobile number').pipe(z.string().max(40)),
    celebrantName: z.string().trim().max(80).optional().nullable(),
    celebrantBirthday: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().nullable(),
    smsOptIn: z.boolean().optional(),
    marketingOptIn: z.boolean().optional(),
    organization: z.string().trim().max(120).optional().nullable(),
  }),
  address: z.string().trim().min(4, 'Enter the event address').max(200),
  city: z.string().trim().min(2, 'Enter the city').max(80),
  state: z.string().trim().min(2).max(30),
  eventType: z.enum(['birthday', 'school', 'church', 'corporate', 'community', 'wedding', 'other']).default('birthday'),
  venue: z.enum(['home', 'park', 'church', 'school', 'business', 'other']).default('home'),
  power: z.enum(['yes', 'no', 'unsure']).default('yes'),
  water: z.enum(['yes', 'no', 'na']).default('na'),
  notes: z.string().trim().max(1500).default(''),
  agreement: z.object({ name: z.string().trim().min(2, 'Type your full name to sign').max(120), accepted: z.literal(true, { message: 'Please accept the rental agreement' }) }),
  leadId: z.uuid().optional().nullable(),
  replaceToken: z.string().max(64).optional().nullable(),
});

const VENUE: Record<string, string> = { home: 'Home / backyard', park: 'Park (permit may be required)', church: 'Church', school: 'School', business: 'Business / office', other: 'Other venue' };

export const POST: APIRoute = async (ctx) => {
  const r = await publicTenant(ctx, 'book', 10, 6);
  if (r instanceof Response) return r;
  const { t, ip } = r;
  let raw: unknown;
  try { raw = await readJson(ctx.request); } catch { return apiError(400, 'bad_json', 'Invalid request.'); }
  const p = Body.safeParse(raw);
  if (!p.success) return zodError(p.error);
  const d = p.data;
  const db = await getDb();

  // A shopper who went back and re-submitted releases their previous hold first.
  if (d.replaceToken) {
    await db.update(schema.bookings).set({ status: 'canceled', holdExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(schema.bookings.tenantId, t.id), eq(schema.bookings.publicToken, d.replaceToken), eq(schema.bookings.status, 'hold')));
  }
  const inv = await loadInventory(db, t.id);
  const lines = cleanLines(d.lines, new Set(inv.filter((i) => i.active).map((i) => i.id)));
  if (!lines.length) return apiError(422, 'empty', 'Your cart is empty.');

  let leadId: string | null = null;
  if (d.leadId) {
    const [l] = await db.select({ id: schema.leads.id }).from(schema.leads).where(and(eq(schema.leads.id, d.leadId), eq(schema.leads.tenantId, t.id))).limit(1);
    leadId = l?.id ?? null;
  }
  const setup = [
    `Venue: ${VENUE[d.venue]}`,
    `Power within 50 ft: ${d.power === 'yes' ? 'Yes' : d.power === 'no' ? 'No — generator needed' : 'Not sure'}`,
    d.water !== 'na' ? `Water/hose access: ${d.water === 'yes' ? 'Yes' : 'No'}` : '',
    d.notes ? `Customer notes: ${d.notes}` : '',
  ].filter(Boolean).join('\n');

  try {
    const { booking } = await createBooking(t, {
      window: d.window, lines, zip: d.zip, surface: d.surface, damageWaiver: d.damageWaiver, couponCode: d.couponCode || null,
      customer: { ...d.customer, celebrantBirthday: d.customer.celebrantBirthday || null, type: d.eventType === 'school' ? 'school' : d.eventType === 'church' ? 'church' : d.eventType === 'corporate' ? 'corporate' : 'residential' },
      address: d.address, city: d.city, state: d.state, eventType: d.eventType, notes: setup,
      status: 'hold',
      agreement: { name: d.agreement.name, ip, text: agreementText(t) },
      attribution: readAttribution(ctx.cookies), leadId, source: 'website',
    });
    const origin = await siteOrigin(t);
    const apiOrigin = new URL(origin).origin;
    const successUrl = `${apiOrigin}/api/public/${t.slug}/confirm?b=${encodeURIComponent(booking.publicToken)}&p=0`;
    const cancelUrl = `${origin}/book?canceled=1`;
    const co = await createCheckout({
      tenant: t, bookingId: booking.id, bookingNumber: booking.number, amountCents: booking.depositCents,
      applicationFeeCents: booking.platformFeeCents, customerEmail: d.customer.email, successUrl, cancelUrl,
      description: `${t.name} — deposit for booking #${booking.number}`,
    });
    return json({
      ok: true, url: co.url, mode: co.mode, token: booking.publicToken, number: booking.number,
      depositCents: booking.depositCents, totalCents: booking.totalCents, holdExpiresAt: booking.holdExpiresAt,
    });
  } catch (e) {
    return bookingErrorResponse(e);
  }
};
