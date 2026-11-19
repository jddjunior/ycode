/**
 * POST /api/public/{tenant}/pay  (form: token) → checkout for the balance due.
 */
import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../db/client';
import { createCheckout } from '../../../../lib/payments';
import { siteOrigin } from '../../../../lib/tenant';
import { apiError, publicTenant, readJson } from '../../../../lib/site/api';

export const POST: APIRoute = async (ctx) => {
  const r = await publicTenant(ctx, 'pay', 10, 6);
  if (r instanceof Response) return r;
  const { t } = r;
  const body = (await readJson(ctx.request).catch(() => ({}))) as Record<string, unknown>;
  const tok = String(body.token ?? '').slice(0, 64);
  const db = await getDb();
  const [b] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.tenantId, t.id), eq(schema.bookings.publicToken, tok))).limit(1);
  if (!b) return apiError(404, 'not_found', 'Booking not found.');
  const origin = await siteOrigin(t);
  const page = `${origin}/booking/${b.publicToken}`;
  const due = b.totalCents - b.paidCents;
  if (due <= 0 || !['pending', 'confirmed', 'hold'].includes(b.status)) return ctx.redirect(page, 303);
  // A lapsed hold that was never paid can't be revived from here.
  if (b.status === 'hold' && b.paidCents === 0 && b.holdExpiresAt && b.holdExpiresAt < new Date()) return ctx.redirect(`${page}?expired=1`, 303);
  const [c] = b.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, b.customerId)) : [];
  const amount = b.paidCents === 0 ? b.depositCents : due;
  try {
    const co = await createCheckout({
      tenant: t, bookingId: b.id, bookingNumber: b.number, amountCents: amount,
      applicationFeeCents: b.paidCents === 0 ? b.platformFeeCents : 0, customerEmail: c?.email ?? t.email,
      successUrl: `${new URL(origin).origin}/api/public/${t.slug}/confirm?b=${encodeURIComponent(b.publicToken)}&p=${b.paidCents}`,
      cancelUrl: page, description: `${t.name} — ${b.paidCents === 0 ? 'deposit' : 'balance'} for booking #${b.number}`,
    });
    return ctx.redirect(co.url, 303);
  } catch (e) {
    console.error('[pay]', e);
    return ctx.redirect(`${page}?payerror=1`, 303);
  }
};
