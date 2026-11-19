/** Dashboard + report aggregates. All functions are tenant-scoped. */
import { and, eq, gte, inArray, lt, sql, desc, count } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import type { Tenant } from '../auth';
import { explode, type InvItem } from '../availability';
import { localDay, addDays } from '../time';
import { FULFIL_STATUSES } from './stops';

const B = schema.bookings;

/** Booked (event-date) totals in [from, to): count + revenue. */
export async function bookedTotals(tenantId: string, from: Date, to: Date) {
  const db = await getDb();
  const [r] = await db.select({
    n: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${B.totalCents}),0)::int`,
    paid: sql<number>`coalesce(sum(${B.paidCents}),0)::int`,
  }).from(B).where(and(eq(B.tenantId, tenantId), inArray(B.status, [...FULFIL_STATUSES]), gte(B.startsAt, from), lt(B.startsAt, to)));
  return r ?? { n: 0, revenue: 0, paid: 0 };
}

export async function unpaidBalances(tenantId: string) {
  const db = await getDb();
  const [r] = await db.select({
    n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${B.totalCents} - ${B.paidCents}),0)::int`,
  }).from(B).where(and(eq(B.tenantId, tenantId), inArray(B.status, ['pending', 'confirmed', 'completed']), sql`${B.totalCents} > ${B.paidCents}`));
  return r ?? { n: 0, cents: 0 };
}

export async function openLeads(tenantId: string) {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(schema.leads).where(and(eq(schema.leads.tenantId, tenantId), inArray(schema.leads.stage, ['new', 'contacted', 'quoted'])));
  return r?.n ?? 0;
}

/**
 * Unit-day utilization of rental inventory over [fromDay, fromDay+days).
 * Packages are exploded into the components they reserve.
 */
export async function utilization(t: Tenant, fromDay: string, days: number) {
  const db = await getDb();
  const items = await db.select().from(schema.items).where(eq(schema.items.tenantId, t.id));
  const inv: InvItem[] = items.map((i) => ({ id: i.id, quantity: i.quantity, setupMinutes: i.setupMinutes, teardownMinutes: i.teardownMinutes, kind: i.kind, bundle: i.bundle, active: i.active }));
  const byId = new Map(inv.map((i) => [i.id, i]));
  const rentals = items.filter((i) => i.kind === 'rental' && i.active);
  const capacity = rentals.reduce((s, i) => s + i.quantity, 0) * days;
  const lines = await db.select({ itemId: schema.bookingLines.itemId, qty: schema.bookingLines.qty, startsAt: B.startsAt })
    .from(schema.bookingLines).innerJoin(B, eq(B.id, schema.bookingLines.bookingId))
    .where(and(eq(B.tenantId, t.id), inArray(B.status, [...FULFIL_STATUSES])));
  const perItem = new Map<string, number>();
  const end = addDays(fromDay, days);
  for (const l of lines) {
    const d = localDay(l.startsAt, t.timezone);
    if (d < fromDay || d >= end) continue;
    for (const x of explode([{ itemId: l.itemId, qty: l.qty }], byId)) perItem.set(x.itemId, (perItem.get(x.itemId) ?? 0) + x.qty);
  }
  const used = rentals.reduce((s, i) => s + Math.min(perItem.get(i.id) ?? 0, i.quantity * days), 0);
  return { used, capacity, pct: capacity ? Math.round((used / capacity) * 100) : 0, perItem, rentals };
}

/** Consecutive weeks (Mon-start, tenant tz) with at least one event, counting back from this week. */
export async function partyStreak(t: Tenant) {
  const db = await getDb();
  const rows = await db.select({ s: B.startsAt }).from(B).where(and(eq(B.tenantId, t.id), inArray(B.status, [...FULFIL_STATUSES]), gte(B.startsAt, new Date(Date.now() - 400 * 86_400_000))));
  const weekKey = (day: string) => {
    const d = new Date(day + 'T12:00:00Z');
    const dow = (d.getUTCDay() + 6) % 7;
    return addDays(day, -dow);
  };
  const weeks = new Set(rows.map((r) => weekKey(localDay(r.s, t.timezone))));
  let wk = weekKey(localDay(new Date(), t.timezone));
  if (!weeks.has(wk)) wk = addDays(wk, -7);
  let n = 0;
  while (weeks.has(wk)) { n++; wk = addDays(wk, -7); }
  return n;
}

export async function recentActivity(tenantId: string, limit = 12) {
  const db = await getDb();
  return db.select().from(schema.activity).where(eq(schema.activity.tenantId, tenantId)).orderBy(desc(schema.activity.createdAt)).limit(limit);
}

export async function logActivity(tenantId: string, kind: string, message: string, data?: Record<string, unknown>) {
  const db = await getDb();
  await db.insert(schema.activity).values({ tenantId, kind, message: message.slice(0, 300), data: data ?? null });
}
