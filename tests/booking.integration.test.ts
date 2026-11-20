/**
 * Integration: real Postgres semantics. Runs on in-memory PGlite by default and on a
 * real Postgres server when TEST_DATABASE_URL is set (CI does both) — the postgres-js
 * driver path has its own serialization behaviour that PGlite does not exercise.
 * Proves holds + advisory lock prevent overbooking under concurrency,
 * payments are idempotent, and the revenue ledger accrues exactly once.
 */
import { describe, it, expect, beforeAll } from 'vitest';

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else process.env.PGLITE_DIR = 'memory';

const { getDb, schema } = await import('../src/db/client');
const { provisionTenant } = await import('../src/lib/provision');
const { createBooking, recordPayment, availability, BookingError } = await import('../src/lib/booking');
const { onBookingPayment } = await import('../src/lib/revenue');
const { addDays } = await import('../src/lib/time');
const { eq } = await import('drizzle-orm');

let tenant: Awaited<ReturnType<typeof provisionTenant>>['tenant'];
let slideId: string;
const day = addDays(new Date().toISOString().slice(0, 10), 20);
const cust = (n: number) => ({ email: `c${n}@example.com`, name: `C ${n}`, phone: '' });

beforeAll(async () => {
  ({ tenant } = await provisionTenant({ name: 'Test Bounce', email: 'owner@test.dev', password: 'test-password-123', city: 'Houston', state: 'TX', zip: '77008' }));
  const db = await getDb();
  const [it] = await db.insert(schema.items).values({ tenantId: tenant.id, slug: 'slide', name: 'Slide', priceCents: 30000, quantity: 1 }).returning();
  slideId = it.id;
}, 60_000);

describe('booking integration', () => {
  it('only one of many concurrent checkouts gets the last unit', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => createBooking(tenant, {
      window: { day, startHour: 10, endHour: 16 }, lines: [{ itemId: slideId, qty: 1 }], zip: '77008',
      customer: cust(i), address: '1 Main', city: 'Houston', state: 'TX',
    })));
    const ok = attempts.filter((a) => a.status === 'fulfilled');
    const failed = attempts.filter((a) => a.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed.every((f) => f.reason instanceof BookingError && f.reason.code === 'unavailable')).toBe(true);
    const av = await availability(tenant, { day, startHour: 12, endHour: 14 });
    expect(av.free[slideId]).toBe(0);
  });

  it('an expired hold frees the unit', async () => {
    const db = await getDb();
    await db.update(schema.bookings).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.bookings.tenantId, tenant.id));
    const av = await availability(tenant, { day, startHour: 12, endHour: 14 });
    expect(av.free[slideId]).toBe(1);
  });

  it('payments confirm the booking, are idempotent, and accrue the platform fee once', async () => {
    const { booking } = await createBooking(tenant, {
      window: { day: addDays(day, 1), startHour: 10, endHour: 16 }, lines: [{ itemId: slideId, qty: 1 }], zip: '77008',
      customer: cust(99), address: '1 Main', city: 'Houston', state: 'TX',
    });
    expect(booking.status).toBe('hold');
    expect(booking.platformFeeCents).toBeGreaterThan(0);
    const p = { provider: 'demo' as const, ref: 'pi_test_1', amountCents: booking.depositCents, applicationFeeCents: booking.platformFeeCents };
    const r1 = await recordPayment(tenant.id, booking.id, p);
    const r2 = await recordPayment(tenant.id, booking.id, p);
    expect(r1.booking.status).toBe('confirmed');
    expect(r2.duplicate).toBe(true);
    expect(r2.booking.paidCents).toBe(booking.depositCents);
    await onBookingPayment({ tenantId: tenant.id, bookingId: booking.id, paymentRef: 'pi_test_1', amountCents: p.amountCents, applicationFeeCents: p.applicationFeeCents });
    await onBookingPayment({ tenantId: tenant.id, bookingId: booking.id, paymentRef: 'pi_test_1', amountCents: p.amountCents, applicationFeeCents: p.applicationFeeCents });
    const db = await getDb();
    const fees = await db.select().from(schema.revenueEvents).where(eq(schema.revenueEvents.bookingId, booking.id));
    expect(fees).toHaveLength(1);
    expect(fees[0].amountCents).toBe(booking.platformFeeCents);
  });

  it('accepts raw JS Dates inside sql templates (postgres-js serializer)', async () => {
    const db = await getDb();
    const { sql } = await import('drizzle-orm');
    const since = new Date(Date.now() - 86_400_000);
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(schema.bookings)
      .where(sql`${schema.bookings.tenantId} = ${tenant.id} and ${schema.bookings.createdAt} >= ${since}`);
    expect(Number(rows[0].n)).toBeGreaterThan(0);
  });

  it('rejects undeliverable ZIPs and enforces lead time', async () => {
    const db = await getDb();
    await db.delete(schema.deliveryZones).where(eq(schema.deliveryZones.tenantId, tenant.id));
    await db.insert(schema.deliveryZones).values({ tenantId: tenant.id, name: 'Only', zips: ['77008'], feeCents: 0 });
    await expect(createBooking(tenant, { window: { day: addDays(day, 3), startHour: 10, endHour: 16 }, lines: [{ itemId: slideId, qty: 1 }], zip: '90210', customer: cust(5), address: '', city: '', state: '' }))
      .rejects.toMatchObject({ code: 'undeliverable' });
    const today = new Date().toISOString().slice(0, 10);
    await expect(createBooking(tenant, { window: { day: today, startHour: 10, endHour: 16 }, lines: [{ itemId: slideId, qty: 1 }], zip: '77008', customer: cust(6), address: '', city: '', state: '' }))
      .rejects.toMatchObject({ code: 'rules' });
  });
});
