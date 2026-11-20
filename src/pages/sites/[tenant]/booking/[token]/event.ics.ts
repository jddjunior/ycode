/** GET {site}/booking/{token}/event.ics — calendar invite for the customer's booking. */
import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../../db/client';
import { siteOrigin } from '../../../../../lib/tenant';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');

export const GET: APIRoute = async ({ locals, params }) => {
  const site = locals.site;
  if (!site || site.tenant.slug !== params.tenant) return new Response('Not found', { status: 404 });
  const t = site.tenant;
  const db = await getDb();
  const [b] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.tenantId, t.id), eq(schema.bookings.publicToken, String(params.token ?? '').slice(0, 64)))).limit(1);
  if (!b || b.status === 'canceled') return new Response('Not found', { status: 404 });
  const lines = await db.select().from(schema.bookingLines).where(eq(schema.bookingLines.bookingId, b.id));
  const link = `${await siteOrigin(t)}/booking/${b.publicToken}`;
  const desc = `${lines.map((l) => `${l.qty} x ${l.name}`).join(', ')}\nBalance due: $${((b.totalCents - b.paidCents) / 100).toFixed(2)}\nBooking: ${link}\nQuestions: ${t.phone || t.email}`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BounceOS//Storefront//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${b.id}@bounceos`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(b.startsAt)}`, `DTEND:${stamp(b.endsAt)}`,
    `SUMMARY:${esc(`${t.name} party rental (#${b.number})`)}`, `LOCATION:${esc(`${b.address}, ${b.city}, ${b.state} ${b.zip}`)}`,
    `DESCRIPTION:${esc(desc)}`, `URL:${link}`,
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${esc('Party tomorrow! Clear the setup area and check the outlet.')}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="booking-${b.number}.ics"`, 'cache-control': 'private, no-store' } });
};
