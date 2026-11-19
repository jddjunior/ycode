/**
 * POST /api/stripe/webhook — Stripe events (signature verified with STRIPE_WEBHOOK_SECRET).
 *  checkout.session.completed → record booking payment + revenue share + confirmation (idempotent by payment_intent)
 *  account.updated            → tenants.stripeChargesEnabled
 *  invoice.paid               → subscription revenue (tenant matched by stripeCustomerId)
 */
import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../../db/client';
import { getStripe, stripeEnabled } from '../../../lib/payments';
import { onSubscriptionPaid } from '../../../lib/revenue';
import { invalidateTenantCache } from '../../../lib/tenant';
import { confirmBookingPayment } from '../../../lib/site/confirm';
import { json } from '../../../lib/site/api';

export const POST: APIRoute = async ({ request }) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeEnabled() || !secret) return json({ error: 'stripe_not_configured' }, 503);
  const sig = request.headers.get('stripe-signature');
  if (!sig) return json({ error: 'missing_signature' }, 400);
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return json({ error: 'bad_signature' }, 400);
  }
  const db = await getDb();
  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode !== 'payment' || s.payment_status !== 'paid') break;
        const tenantId = s.metadata?.tenantId, bookingId = s.metadata?.bookingId;
        if (!tenantId || !bookingId) break;
        const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
        if (!t) break;
        const [b] = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, t.id))).limit(1);
        if (!b) break;
        const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
        let fee = 0;
        if (piId) {
          const pi = await getStripe().paymentIntents.retrieve(piId);
          fee = pi.application_fee_amount ?? 0;
        }
        await confirmBookingPayment(t, b.id, { provider: 'stripe', ref: piId ?? s.id, amountCents: s.amount_total ?? 0, applicationFeeCents: fee });
        break;
      }
      case 'account.updated': {
        const a = event.data.object as Stripe.Account;
        await db.update(schema.tenants).set({ stripeChargesEnabled: !!a.charges_enabled, updatedAt: new Date() }).where(eq(schema.tenants.stripeAccountId, a.id));
        invalidateTenantCache();
        break;
      }
      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
        if (!customerId || !inv.id) break;
        const [t] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.stripeCustomerId, customerId)).limit(1);
        if (!t) break;
        await onSubscriptionPaid({ tenantId: t.id, invoiceRef: inv.id, amountCents: inv.amount_paid ?? 0 });
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error('[stripe webhook]', event.type, e);
    return json({ error: 'handler_failed' }, 500); // Stripe retries; handlers are idempotent
  }
  return json({ received: true });
};
