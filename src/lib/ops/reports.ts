/** Report queries (tenant-scoped). Shared by /app/reports and the CSV endpoints. */
import { sql } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import type { Tenant } from '../auth';
import { localDay, addDays } from '../time';
import { utilization } from './stats';
import type { OpsSpecs } from './items';

const B = schema.bookings;
const LIVE = sql`${B.status} in ('pending','confirmed','completed')`;

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const db = await getDb();
  const r = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : r.rows ?? [];
}

/** Last `n` month keys ending with the current month ('YYYY-MM'). */
export function lastMonths(t: Tenant, n = 12) {
  const today = localDay(new Date(), t.timezone);
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 7));
}
export const monthLabel = (k: string) => new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(k + '-15T12:00:00Z'));

export async function revenueByMonth(t: Tenant, months: string[]) {
  const from = months[0] + '-01';
  const booked = await rows<{ k: string; n: number; revenue: number; tax: number }>(sql`
    select to_char(${B.startsAt} at time zone ${t.timezone}, 'YYYY-MM') k, count(*)::int n, coalesce(sum(${B.totalCents}),0)::int revenue, coalesce(sum(${B.taxCents}),0)::int tax
    from ${B} where ${B.tenantId} = ${t.id} and ${LIVE} and (${B.startsAt} at time zone ${t.timezone})::date >= ${from}::date group by 1`);
  const P = schema.payments;
  const paid = await rows<{ k: string; collected: number; fees: number }>(sql`
    select to_char(${P.createdAt} at time zone ${t.timezone}, 'YYYY-MM') k, coalesce(sum(${P.amountCents}),0)::int collected, coalesce(sum(${P.applicationFeeCents}),0)::int fees
    from ${P} where ${P.tenantId} = ${t.id} and ${P.status} = 'succeeded' and (${P.createdAt} at time zone ${t.timezone})::date >= ${from}::date group by 1`);
  const bm = new Map(booked.map((r) => [r.k, r])), pm = new Map(paid.map((r) => [r.k, r]));
  return months.map((k) => ({ k, label: monthLabel(k), n: bm.get(k)?.n ?? 0, revenue: bm.get(k)?.revenue ?? 0, collected: pm.get(k)?.collected ?? 0, fees: pm.get(k)?.fees ?? 0 }));
}

export async function revenueByCategory(t: Tenant, fromDay: string) {
  const L = schema.bookingLines, I = schema.items, C = schema.categories;
  return rows<{ name: string; revenue: number; units: number }>(sql`
    select coalesce(${C.name}, 'Uncategorized') name, coalesce(sum(${L.totalCents}),0)::int revenue, coalesce(sum(${L.qty}),0)::int units
    from ${L} join ${B} on ${B.id} = ${L.bookingId} join ${I} on ${I.id} = ${L.itemId} left join ${C} on ${C.id} = ${I.categoryId}
    where ${L.tenantId} = ${t.id} and ${LIVE} and (${B.startsAt} at time zone ${t.timezone})::date >= ${fromDay}::date
    group by 1 order by 2 desc`);
}

export async function revenueByChannel(t: Tenant, fromDay: string) {
  return rows<{ channel: string; n: number; revenue: number }>(sql`
    select coalesce(nullif(${B.attribution}->>'channel',''), 'direct') channel, count(*)::int n, coalesce(sum(${B.totalCents}),0)::int revenue
    from ${B} where ${B.tenantId} = ${t.id} and ${LIVE} and (${B.startsAt} at time zone ${t.timezone})::date >= ${fromDay}::date
    group by 1 order by 3 desc`);
}

/** Sales tax per month or quarter for a calendar year (by event date). */
export async function salesTax(t: Tenant, year: number, period: 'month' | 'quarter') {
  const fmt = period === 'quarter' ? `YYYY-"Q"Q` : 'YYYY-MM';
  return rows<{ period: string; n: number; gross: number; taxable: number; tax: number; delivery: number }>(sql`
    select to_char(${B.startsAt} at time zone ${t.timezone}, ${fmt}) period, count(*)::int n,
      coalesce(sum(${B.totalCents}),0)::int gross,
      coalesce(sum(${B.subtotalCents} - ${B.discountCents} + ${B.damageWaiverCents} + ${B.surfaceCents}),0)::int taxable,
      coalesce(sum(${B.taxCents}),0)::int tax, coalesce(sum(${B.deliveryCents}),0)::int delivery
    from ${B} where ${B.tenantId} = ${t.id} and ${LIVE} and extract(year from ${B.startsAt} at time zone ${t.timezone}) = ${year}
    group by 1 order by 1`);
}

export async function balances(t: Tenant) {
  const [r] = await rows<{ upcoming_n: number; upcoming_total: number; upcoming_deposit: number; upcoming_paid: number; overdue_n: number; overdue_due: number; short_deposit_n: number }>(sql`
    select
      count(*) filter (where ${B.endsAt} >= now())::int upcoming_n,
      coalesce(sum(${B.totalCents}) filter (where ${B.endsAt} >= now()),0)::int upcoming_total,
      coalesce(sum(${B.depositCents}) filter (where ${B.endsAt} >= now()),0)::int upcoming_deposit,
      coalesce(sum(${B.paidCents}) filter (where ${B.endsAt} >= now()),0)::int upcoming_paid,
      count(*) filter (where ${B.endsAt} < now() and ${B.totalCents} > ${B.paidCents})::int overdue_n,
      coalesce(sum(${B.totalCents} - ${B.paidCents}) filter (where ${B.endsAt} < now() and ${B.totalCents} > ${B.paidCents}),0)::int overdue_due,
      count(*) filter (where ${B.endsAt} >= now() and ${B.paidCents} < ${B.depositCents})::int short_deposit_n
    from ${B} where ${B.tenantId} = ${t.id} and ${LIVE}`);
  return r;
}

/** Item utilization over the last `days` days plus lifetime revenue, maintenance and ROI. */
export async function itemPerformance(t: Tenant, days = 90) {
  const today = localDay(new Date(), t.timezone);
  const u = await utilization(t, addDays(today, -days), days);
  const L = schema.bookingLines, M = schema.maintenanceLogs;
  const rev = await rows<{ item_id: string; revenue: number; n: number }>(sql`
    select ${L.itemId} item_id, coalesce(sum(${L.totalCents}),0)::int revenue, count(distinct ${L.bookingId})::int n
    from ${L} join ${B} on ${B.id} = ${L.bookingId} where ${L.tenantId} = ${t.id} and ${LIVE} group by 1`);
  const mnt = await rows<{ item_id: string; cost: number }>(sql`select ${M.itemId} item_id, coalesce(sum(${M.costCents}),0)::int cost from ${M} where ${M.tenantId} = ${t.id} group by 1`);
  const rm = new Map(rev.map((r) => [r.item_id, r])), mm = new Map(mnt.map((r) => [r.item_id, r.cost]));
  const db = await getDb();
  const items = await db.select().from(schema.items).where(sql`${schema.items.tenantId} = ${t.id}`);
  return items.filter((i) => i.kind !== 'package').map((i) => {
    const used = u.perItem.get(i.id) ?? 0;
    const cap = i.quantity * days;
    const revenue = rm.get(i.id)?.revenue ?? 0, cost = mm.get(i.id) ?? 0;
    const purchase = (i.specs as OpsSpecs).purchaseCostCents ?? null;
    return { id: i.id, name: i.name, kind: i.kind, quantity: i.quantity, unitDays: used, util: cap ? Math.min(100, Math.round((used / cap) * 100)) : 0, bookings: rm.get(i.id)?.n ?? 0, revenue, maintenance: cost, purchase, roi: purchase ? Math.round(((revenue - cost) / purchase) * 100) : null };
  }).sort((a, b) => b.revenue - a.revenue);
}

export function toCsv(header: string[], data: (string | number | null)[][]) {
  // Quote fields with separators; neutralise spreadsheet formulas in text cells.
  const esc = (v: string | number | null) => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...data].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
export const dollars = (c: number) => (c / 100).toFixed(2);
