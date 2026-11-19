/**
 * Shared "a booking payment succeeded" pipeline used by the demo confirmation
 * endpoint and the Stripe webhook. Idempotent: recordPayment de-dupes on the
 * provider reference, and side effects only run for the first delivery.
 */
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import type { Tenant } from '../auth';
import { recordPayment, bookingWithLines } from '../booking';
import { onBookingPayment } from '../revenue';
import { send } from '../notify';
import { money } from '../pricing';
import { formatLocal } from '../time';
import { siteOrigin } from '../tenant';

export interface PaymentInput {
  provider: 'stripe' | 'demo';
  ref: string;
  amountCents: number;
  applicationFeeCents: number;
}

export async function confirmBookingPayment(t: Tenant, bookingId: string, p: PaymentInput) {
  const { booking, duplicate } = await recordPayment(t.id, bookingId, { provider: p.provider, ref: p.ref, amountCents: p.amountCents, applicationFeeCents: p.applicationFeeCents });
  if (!booking || duplicate) return { booking, duplicate: true };
  await onBookingPayment({ tenantId: t.id, bookingId, paymentRef: p.ref, amountCents: p.amountCents, applicationFeeCents: p.applicationFeeCents });

  const db = await getDb();
  if (booking.leadId) {
    await db.update(schema.leads).set({ stage: 'won' }).where(and(eq(schema.leads.id, booking.leadId), eq(schema.leads.tenantId, t.id)));
  }
  const full = await bookingWithLines(t.id, bookingId);
  const firstPayment = booking.paidCents === p.amountCents;
  const balance = Math.max(0, booking.totalCents - booking.paidCents);
  await db.insert(schema.activity).values({
    tenantId: t.id, kind: firstPayment ? 'booking_paid' : 'payment',
    message: firstPayment
      ? `New online booking #${booking.number} — ${money(p.amountCents)} deposit paid${booking.city ? ` (${booking.city})` : ''}`
      : `Payment of ${money(p.amountCents)} received for booking #${booking.number}`,
    data: { bookingId, amountCents: p.amountCents, provider: p.provider, channel: booking.attribution?.channel ?? null },
  });

  const c = full?.customer;
  if (c) {
    const link = `${await siteOrigin(t)}/booking/${booking.publicToken}`;
    const when = `${formatLocal(booking.startsAt, t.timezone, { weekday: 'long', month: 'long', day: 'numeric' })}, ${formatLocal(booking.startsAt, t.timezone, { hour: 'numeric', minute: '2-digit' })}–${formatLocal(booking.endsAt, t.timezone, { hour: 'numeric', minute: '2-digit' })}`;
    const items = (full?.lines ?? []).map((l) => `• ${l.qty > 1 ? l.qty + ' × ' : ''}${l.name}`).join('\n');
    const subject = firstPayment ? `You're booked! ${t.name} — booking #${booking.number}` : `Payment received — booking #${booking.number}`;
    const body = [
      `Hi ${c.name.split(' ')[0] || 'there'},`,
      firstPayment ? `You're booked for ${when}. We'll text you an arrival window the day before.` : `We received your payment of ${money(p.amountCents)}. Thank you!`,
      items,
      `Paid so far: ${money(booking.paidCents)} of ${money(booking.totalCents)}.${balance ? ` Balance due: ${money(balance)}.` : ' Paid in full.'}`,
      booking.address ? `Delivery to: ${booking.address}, ${booking.city} ${booking.zip}` : '',
      firstPayment ? 'Before we arrive: mow the area, mark sprinkler heads, clear pet waste, and make sure an outlet is within 50 ft.' : '',
      `View, pay or add to your calendar: ${link}`,
      `Questions? Call or text ${t.phone || t.email}.`,
      `— ${t.name}`,
    ].filter(Boolean).join('\n\n');
    if (c.email) await send({ tenantId: t.id, channel: 'email', to: c.email, subject, body, customerId: c.id, bookingId, fromName: t.name, replyTo: t.email || undefined });
    if (c.phone && c.smsOptIn) {
      const sms = firstPayment
        ? `${t.name}: You're booked for ${when} (#${booking.number}). Details: ${link}`
        : `${t.name}: Payment of ${money(p.amountCents)} received for #${booking.number}. ${link}`;
      await send({ tenantId: t.id, channel: 'sms', to: c.phone, body: sms, customerId: c.id, bookingId });
    }
  }
  return { booking, duplicate: false };
}
