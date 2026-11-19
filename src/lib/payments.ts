/**
 * Payments via Stripe Connect (destination = operator's connected account,
 * application_fee_amount = Branch Avenue platform fee).
 *
 * STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET come from the environment.
 * Without them the platform runs in DEMO mode: checkout completes through a
 * signed internal confirmation link so the whole flow is testable.
 */
import Stripe from 'stripe';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Tenant } from './auth';

let stripe: Stripe | null = null;
export const stripeEnabled = () => !!process.env.STRIPE_SECRET_KEY;
export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe not configured');
  return (stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY));
}

const demoSecret = () => process.env.SESSION_SECRET ?? process.env.DEMO_PAYMENT_SECRET ?? 'dev-only-demo-secret';

export function demoSignature(bookingId: string, amount: number) {
  return createHmac('sha256', demoSecret()).update(`${bookingId}:${amount}`).digest('base64url');
}
export function verifyDemoSignature(bookingId: string, amount: number, sig: string) {
  const a = Buffer.from(demoSignature(bookingId, amount)), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface CheckoutArgs {
  tenant: Tenant; bookingId: string; bookingNumber: number; amountCents: number; applicationFeeCents: number;
  customerEmail: string; successUrl: string; cancelUrl: string; description: string;
}

/** Returns a URL to send the shopper to. */
export async function createCheckout(a: CheckoutArgs): Promise<{ url: string; mode: 'stripe' | 'demo' }> {
  if (!stripeEnabled() || !a.tenant.stripeAccountId || !a.tenant.stripeChargesEnabled) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_PAYMENTS !== 'true' && stripeEnabled()) {
      throw new Error('This business has not finished connecting payments yet.');
    }
    const u = new URL(a.successUrl);
    u.searchParams.set('demo', '1');
    u.searchParams.set('amt', String(a.amountCents));
    u.searchParams.set('sig', demoSignature(a.bookingId, a.amountCents));
    return { url: u.toString(), mode: 'demo' };
  }
  const s = getStripe();
  const session = await s.checkout.sessions.create({
    mode: 'payment',
    customer_email: a.customerEmail,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: a.amountCents, product_data: { name: a.description } } }],
    payment_intent_data: {
      application_fee_amount: a.applicationFeeCents,
      transfer_data: { destination: a.tenant.stripeAccountId },
      on_behalf_of: a.tenant.stripeAccountId,
      metadata: { tenantId: a.tenant.id, bookingId: a.bookingId, bookingNumber: String(a.bookingNumber) },
      setup_future_usage: 'off_session', // allows auto-charging the balance before the event
    },
    metadata: { tenantId: a.tenant.id, bookingId: a.bookingId },
    success_url: a.successUrl + (a.successUrl.includes('?') ? '&' : '?') + 'session_id={CHECKOUT_SESSION_ID}',
    cancel_url: a.cancelUrl,
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
  }, { idempotencyKey: `checkout:${a.bookingId}:${a.amountCents}` });
  return { url: session.url!, mode: 'stripe' };
}

/** Express account onboarding link for an operator. */
export async function connectOnboardingLink(t: Tenant, returnUrl: string, refreshUrl: string): Promise<{ url: string; accountId: string } | null> {
  if (!stripeEnabled()) return null;
  const s = getStripe();
  let accountId = t.stripeAccountId;
  if (!accountId) {
    const acct = await s.accounts.create({ type: 'express', country: 'US', email: t.email || undefined, business_profile: { name: t.name, mcc: '7394' }, metadata: { tenantId: t.id } });
    accountId = acct.id;
  }
  const link = await s.accountLinks.create({ account: accountId, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl });
  return { url: link.url, accountId };
}
