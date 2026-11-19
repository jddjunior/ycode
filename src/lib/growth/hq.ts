/** Cross-tenant platform metrics for Branch Avenue HQ (platform admins only). */
import { and, gte, sql, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import { PLANS } from '../plans';

const GMV_STATUSES = ['pending', 'confirmed', 'completed'] as const;

export async function platformKpis(sinceDays = 30) {
  const db = await getDb();
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const tenants = await db.select({ plan: schema.tenants.plan, status: schema.tenants.status }).from(schema.tenants);
  const mrr = tenants.filter((t) => t.status === 'active' || t.status === 'past_due').reduce((s, t) => s + PLANS[t.plan].monthlyCents, 0);
  const trialMrr = tenants.filter((t) => t.status === 'trial').reduce((s, t) => s + PLANS[t.plan].monthlyCents, 0);
  const B = schema.bookings;
  const [gmv] = await db.select({ all: sql<number>`coalesce(sum(${B.totalCents}),0)::bigint`, recent: sql<number>`coalesce(sum(${B.totalCents}) filter (where ${B.createdAt} >= ${since}),0)::bigint`, n: sql<number>`count(*)::int`, nRecent: sql<number>`count(*) filter (where ${B.createdAt} >= ${since})::int` })
    .from(B).where(inArray(B.status, [...GMV_STATUSES]));
  const R = schema.revenueEvents;
  const byKind = await db.select({ kind: R.kind, all: sql<number>`coalesce(sum(${R.amountCents}),0)::bigint`, recent: sql<number>`coalesce(sum(${R.amountCents}) filter (where ${R.createdAt} >= ${since}),0)::bigint` })
    .from(R).where(sql`${R.status} <> 'void'`).groupBy(R.kind);
  const k = (kind: string, f: 'all' | 'recent' = 'all') => Number(byKind.find((x) => x.kind === kind)?.[f] ?? 0);
  const txRevenue = k('platform_fee') + k('marketplace_lead_fee');
  return {
    tenants: tenants.length, active: tenants.filter((t) => t.status === 'active').length, trial: tenants.filter((t) => t.status === 'trial').length,
    pastDue: tenants.filter((t) => t.status === 'past_due').length, mrr, trialMrr,
    gmv: Number(gmv.all), gmvRecent: Number(gmv.recent), bookings: gmv.n, bookingsRecent: gmv.nRecent,
    platformFees: k('platform_fee'), platformFeesRecent: k('platform_fee', 'recent'),
    marketplaceFees: k('marketplace_lead_fee'), adsFees: k('ads_management_fee'), subscriptions: k('subscription'),
    payouts: k('referral_commission') + k('partner_referral'),
    takeRate: Number(gmv.all) ? txRevenue / Number(gmv.all) : 0,
  };
}

export async function tenantTable() {
  const db = await getDb();
  const T = schema.tenants, B = schema.bookings;
  const rows = await db.select({
    t: T,
    gmv: sql<number>`coalesce((select sum(${B.totalCents}) from ${B} where ${B.tenantId} = ${T.id} and ${B.status} in ('pending','confirmed','completed')),0)::bigint`,
    bookings: sql<number>`(select count(*) from ${B} where ${B.tenantId} = ${T.id} and ${B.status} in ('pending','confirmed','completed'))::int`,
    lastActivity: sql<Date | null>`greatest((select max(${schema.activity.createdAt}) from ${schema.activity} where ${schema.activity.tenantId} = ${T.id}), (select max(${B.updatedAt}) from ${B} where ${B.tenantId} = ${T.id}), ${T.updatedAt})`,
    fees: sql<number>`coalesce((select sum(${schema.revenueEvents.amountCents}) from ${schema.revenueEvents} where ${schema.revenueEvents.tenantId} = ${T.id} and ${schema.revenueEvents.beneficiaryTenantId} is null and ${schema.revenueEvents.status} <> 'void'),0)::bigint`,
  }).from(T);
  return rows.map((r) => ({ ...r, gmv: Number(r.gmv), fees: Number(r.fees), lastActivity: r.lastActivity ? new Date(r.lastActivity) : null })).sort((a, b) => b.gmv - a.gmv);
}

export async function marketplaceStats(sinceDays = 90) {
  const db = await getDb();
  const M = schema.marketplaceLeads, L = schema.leads;
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const [m] = await db.select({ total: sql<number>`count(*)::int`, routed: sql<number>`count(*) filter (where jsonb_array_length(${M.routedTenantIds}) > 0)::int`, unrouted: sql<number>`count(*) filter (where jsonb_array_length(${M.routedTenantIds}) = 0)::int`, recent: sql<number>`count(*) filter (where ${M.createdAt} >= ${since})::int` }).from(M);
  const [w] = await db.select({ won: sql<number>`count(distinct ${L.marketplaceLeadId})::int`, routes: sql<number>`count(*)::int` }).from(L).where(and(eq(L.source, 'marketplace'), sql`${L.marketplaceLeadId} is not null`, eq(L.stage, 'won')));
  const [r] = await db.select({ routes: sql<number>`count(*)::int` }).from(L).where(eq(L.source, 'marketplace'));
  const [wonDirect] = await db.select({ n: sql<number>`count(*)::int` }).from(M).where(sql`${M.wonByTenantId} is not null`);
  const [mb] = await db.select({ n: sql<number>`count(*)::int`, gmv: sql<number>`coalesce(sum(${schema.bookings.totalCents}),0)::bigint` }).from(schema.bookings).where(and(sql`${schema.bookings.attribution}->>'channel' = 'marketplace'`, inArray(schema.bookings.status, [...GMV_STATUSES])));
  const zips = await db.select({ zip: M.zip, n: sql<number>`count(*)::int`, unrouted: sql<number>`count(*) filter (where jsonb_array_length(${M.routedTenantIds}) = 0)::int` }).from(M).groupBy(M.zip).orderBy(sql`count(*) desc`).limit(12);
  const recentLeads = await db.select().from(M).orderBy(sql`${M.createdAt} desc`).limit(25);
  return { ...m, won: Math.max(w.won, wonDirect.n), routes: r.routes, bookings: mb.n, gmv: Number(mb.gmv), zips, recentLeads };
}

export async function topCities(limit = 10) {
  const db = await getDb();
  const B = schema.bookings;
  return db.select({ city: B.city, state: B.state, n: sql<number>`count(*)::int`, gmv: sql<number>`coalesce(sum(${B.totalCents}),0)::bigint`, tenants: sql<number>`count(distinct ${B.tenantId})::int` })
    .from(B).where(and(inArray(B.status, [...GMV_STATUSES]), sql`${B.city} <> ''`)).groupBy(B.city, B.state).orderBy(sql`sum(${B.totalCents}) desc`).limit(limit);
}

export async function signupsByWeek(weeks = 8) {
  const db = await getDb();
  return db.select({ wk: sql<string>`to_char(date_trunc('week', ${schema.tenants.createdAt}), 'Mon DD')`, n: sql<number>`count(*)::int` }).from(schema.tenants)
    .where(gte(schema.tenants.createdAt, new Date(Date.now() - weeks * 7 * 86_400_000))).groupBy(sql`date_trunc('week', ${schema.tenants.createdAt})`).orderBy(sql`date_trunc('week', ${schema.tenants.createdAt})`);
}
