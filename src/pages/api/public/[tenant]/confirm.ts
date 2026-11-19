/**
 * GET /api/public/{tenant}/confirm?b={token}&p={paidBefore}
 *   Demo mode:   &demo=1&amt=&sig=   → verify HMAC, record payment, notify.
 *   Stripe mode: &session_id=cs_…    → verify the session with Stripe (the
 *                webhook does the same; both are idempotent by payment_intent).
 * Then 303 → the customer's booking page.
 */
import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../db/client';
import { getStripe, stripeEnabled, verifyDemoSignature } from '../../../../lib/payments';
import { siteOrigin } from '../../../../lib/tenant';
import { confirmBookingPayment } from '../../../../lib/site/confirm';
import { apiError, publicTenant } from '../../../../lib/site/api';

export const GET: APIRoute = async (ctx) => {
  const r = await publicTenant(ctx, 'confirm', 20, 20);
  if (r instanceof Response) return r;
  const { t } = r;
  const q = ctx.url.searchParams;
  const tokenStr = (q.get('b') ?? '').slice(0, 64);
  const db = await getDb();
  const [b] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.tenantId, t.id), eq(schema.bookings.publicToken, tokenStr))).limit(1);
  if (!b) return apiError(404, 'not_found', 'Booking not found.');
  const page = `${await siteOrigin(t)}/booking/${b.publicToken}`;

  try {
    if (q.get('demo') === '1') {
      const amt = Number.parseInt(q.get('amt') ?? '', 10);
      const before = Number.parseInt(q.get('p') ?? '0', 10);
      const sig = q.get('sig') ?? '';
      if (!Number.isFinite(amt) || amt <= 0 || !verifyDemoSignature(b.id, amt, sig)) return apiError(400, 'bad_signature', 'This payment link is invalid.');
      const ref = `demo:${b.id}:${before}:${amt}`;
      const [dupe] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.providerRef, ref)).limit(1);
      if (!dupe) {
        if (before !== b.paidCents || amt > Math.max(0, b.totalCents - b.paidCents)) return ctx.redirect(`${page}?stale=1`, 303);
        if (b.status === 'canceled') return ctx.redirect(`${page}?expired=1`, 303);
        await confirmBookingPayment(t, b.id, { provider: 'demo', ref, amountCents: amt, applicationFeeCents: before === 0 ? b.platformFeeCents : 0 });
      }
      return ctx.redirect(`${page}?confirmed=1${before === 0 ? '' : '&balance=1'}`, 303);
    }
    const sid = q.get('session_id');
    if (sid && stripeEnabled()) {
      const s = await getStripe().checkout.sessions.retrieve(sid, { expand: ['payment_intent'] });
      if (s.metadata?.bookingId === b.id && s.payment_status === 'paid') {
        const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? s.id;
        const fee = typeof s.payment_intent === 'object' && s.payment_intent ? s.payment_intent.application_fee_amount ?? 0 : 0;
        await confirmBookingPayment(t, b.id, { provider: 'stripe', ref: pi, amountCents: s.amount_total ?? 0, applicationFeeCents: fee });
        return ctx.redirect(`${page}?confirmed=1`, 303);
      }
    }
  } catch (e) {
    console.error('[confirm]', e);
  }
  return ctx.redirect(page, 303);
};
