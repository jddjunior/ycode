/**
 * Delivery / pickup stops for a day, route ordering and event-day weather.
 * Drop-offs are due at startsAt minus the longest setup time on the booking;
 * pickups are due after endsAt. Used by Game Plan, Deliveries and the Crew app.
 */
import { and, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import type { Tenant } from '../auth';
import { planRoute, googleMapsDirections } from '../geo';
import { forecast, type WeatherRisk } from '../weather';
import { dayBounds } from './ctx';

type Booking = typeof schema.bookings.$inferSelect;
type Customer = typeof schema.customers.$inferSelect;
type Line = typeof schema.bookingLines.$inferSelect;

export interface DayStop {
  key: string;
  kind: 'dropoff' | 'pickup';
  booking: Booking;
  customer: Customer | null;
  lines: (Line & { kind: string; isWet: boolean })[];
  dueAt: Date;
  setupMinutes: number;
  done: boolean;
  eta?: number;
  seq?: number;
}

export const FULFIL_STATUSES = ['pending', 'confirmed', 'completed'] as const;

export async function stopsForDay(t: Tenant, day: string): Promise<DayStop[]> {
  const db = await getDb();
  const { from, to } = dayBounds(day, t.timezone);
  const rows = await db.select({ b: schema.bookings, c: schema.customers }).from(schema.bookings)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.bookings.customerId))
    .where(and(
      eq(schema.bookings.tenantId, t.id),
      inArray(schema.bookings.status, [...FULFIL_STATUSES]),
      or(and(gte(schema.bookings.startsAt, from), lt(schema.bookings.startsAt, to)), and(gte(schema.bookings.endsAt, from), lt(schema.bookings.endsAt, to))),
    ));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.b.id);
  const lines = await db.select({ l: schema.bookingLines, kind: schema.items.kind, isWet: schema.items.isWet, setup: schema.items.setupMinutes })
    .from(schema.bookingLines).innerJoin(schema.items, eq(schema.items.id, schema.bookingLines.itemId))
    .where(and(eq(schema.bookingLines.tenantId, t.id), inArray(schema.bookingLines.bookingId, ids)));
  const out: DayStop[] = [];
  for (const { b, c } of rows) {
    const ls = lines.filter((l) => l.l.bookingId === b.id);
    const setup = Math.max(30, ...ls.map((l) => l.setup));
    const mapped = ls.map((l) => ({ ...l.l, kind: l.kind, isWet: l.isWet }));
    if (b.startsAt >= from && b.startsAt < to) {
      out.push({ key: `d:${b.id}`, kind: 'dropoff', booking: b, customer: c, lines: mapped, setupMinutes: setup, dueAt: new Date(b.startsAt.getTime() - setup * 60_000), done: !!b.deliveredAt });
    }
    if (b.endsAt >= from && b.endsAt < to) {
      out.push({ key: `p:${b.id}`, kind: 'pickup', booking: b, customer: c, lines: mapped, setupMinutes: setup, dueAt: b.endsAt, done: !!b.pickedUpAt });
    }
  }
  return out.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

export function depotOf(t: Tenant) {
  return t.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : null;
}

export interface Run { kind: 'dropoff' | 'pickup'; label: string; ordered: (DayStop & { seq: number })[]; miles: number; lateMin: number; mapsUrl: string | null }

/**
 * Plan the day as two runs — the morning drop-off run and the afternoon pickup
 * run — each ordered with planRoute (deadlines first, then 2-opt). Stops
 * without coordinates are appended to their run by due time.
 */
export function routeStops(t: Tenant, stops: DayStop[]) {
  const depot = depotOf(t);
  let seq = 0;
  const runs: Run[] = [];
  for (const kind of ['dropoff', 'pickup'] as const) {
    const list = stops.filter((s) => s.kind === kind);
    if (!list.length) continue;
    const geo = list.filter((s) => s.booking.lat != null && s.booking.lng != null);
    const rest = list.filter((s) => s.booking.lat == null || s.booking.lng == null);
    let ordered: DayStop[] = list, miles = 0, lateMin = 0, mapsUrl: string | null = null;
    if (depot && geo.length) {
      const firstDue = Math.min(...geo.map((s) => s.dueAt.getTime()));
      const plan = planRoute(depot, geo.map((s) => ({ id: s.key, lat: s.booking.lat!, lng: s.booking.lng!, dueBy: kind === 'pickup' ? s.dueAt.getTime() + 2 * 3_600_000 : s.dueAt.getTime() })),
        kind === 'pickup' ? { startAt: firstDue - 30 * 60_000 } : {});
      const byKey = new Map(geo.map((s) => [s.key, s]));
      // Pickups can't happen before the event ends: clamp ETAs to the end time.
      ordered = [...plan.order.map((o, i) => { const st = byKey.get(o.id)!; return { ...st, eta: kind === 'pickup' ? Math.max(plan.etas[i], st.dueAt.getTime()) : plan.etas[i] }; }), ...rest];
      miles = plan.miles; lateMin = kind === 'dropoff' ? Math.round(plan.late / 60_000) : 0;
      mapsUrl = googleMapsDirections(depot, plan.order.map((o) => ({ lat: o.lat, lng: o.lng })));
    }
    runs.push({ kind, label: kind === 'dropoff' ? 'Drop-off run' : 'Pickup run', ordered: ordered.map((s) => ({ ...s, seq: ++seq })), miles, lateMin, mapsUrl });
  }
  const ordered = runs.flatMap((r) => r.ordered);
  return { runs, ordered, miles: runs.reduce((a, r) => a + r.miles, 0), lateMin: runs.reduce((a, r) => a + r.lateMin, 0), routed: runs.some((r) => r.mapsUrl) };
}

/** Weather risk for each day (null = forecast unavailable or out of range). */
export async function weatherFor(t: Tenant, days: string[]): Promise<Record<string, WeatherRisk | null>> {
  const depot = depotOf(t);
  const limit = t.settings?.windLimitMph ?? 15;
  const out: Record<string, WeatherRisk | null> = {};
  await Promise.all([...new Set(days)].map(async (d) => { out[d] = depot ? await forecast(depot.lat, depot.lng, d, limit) : null; }));
  return out;
}

/** Aggregated load list: items per crew member (truck) for drop-offs. */
export function loadList(stops: DayStop[]) {
  const trucks = new Map<string, Map<string, { name: string; qty: number; wet: boolean }>>();
  for (const s of stops) {
    if (s.kind !== 'dropoff') continue;
    const k = s.booking.crewUserId ?? '';
    const m = trucks.get(k) ?? new Map();
    for (const l of s.lines) {
      const cur = m.get(l.itemId) ?? { name: l.name, qty: 0, wet: l.isWet };
      cur.qty += l.qty; m.set(l.itemId, cur);
    }
    trucks.set(k, m);
  }
  return trucks;
}

export const CHECKLIST = [
  { key: 'arrived', label: 'Arrived on site' },
  { key: 'anchored', label: 'Anchored (stakes / sandbags)' },
  { key: 'blower', label: 'Blower tested' },
  { key: 'safety', label: 'Safety talk given' },
  { key: 'signed', label: 'Customer signed off' },
  { key: 'photos', label: 'Setup photos taken' },
] as const;
