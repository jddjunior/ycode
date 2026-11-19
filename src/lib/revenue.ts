/**
 * Revenue-share engine. Every money movement that involves Branch Avenue or
 * an operator-to-operator share is written to the immutable `revenue_events`
 * ledger. (kind, sourceRef) is unique so webhook retries are idempotent.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema, type DB } from '../db/client';
import { PLANS, MARKETPLACE_FEE_BPS, REFERRAL_MONTHS } from './plans';

type Kind = typeof schema.revenueEvents.$inferInsert['kind'];

export async function accrue(db: DB, e: { kind: Kind; tenantId?: string | null; beneficiaryTenantId?: string | null; amountCents: number; bookingId?: string | null; sourceRef: string; memo?: string }) {
  if (e.amountCents <= 0) return null;
  const [row] = await db.insert(schema.revenueEvents).values({
    kind: e.kind, tenantId: e.tenantId ?? null, beneficiaryTenantId: e.beneficiaryTenantId ?? null,
    amountCents: e.amountCents, bookingId: e.bookingId ?? null, sourceRef: e.sourceRef, memo: e.memo ?? '',
  }).onConflictDoNothing().returning();
  return row ?? null;
}

const bps = (amt: number, b: number) => Math.round((amt * b) / 10_000);

/** Called after any successful booking payment. */
export async function onBookingPayment(p: { tenantId: string; bookingId: string; paymentRef: string; amountCents: number; applicationFeeCents: number }) {
  const db = await getDb();
  await accrue(db, { kind: 'platform_fee', tenantId: p.tenantId, amountCents: p.applicationFeeCents, bookingId: p.bookingId, sourceRef: p.paymentRef, memo: 'Platform fee on booking payment' });

  const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, p.bookingId)).limit(1);
  if (!b) return;
  // Marketplace-originated booking → marketplace fee on the booking subtotal, once.
  if (b.attribution?.channel === 'marketplace') {
    await accrue(db, { kind: 'marketplace_lead_fee', tenantId: p.tenantId, amountCents: bps(b.subtotalCents, MARKETPLACE_FEE_BPS), bookingId: b.id, sourceRef: `mkt:${b.id}`, memo: 'BounceOS marketplace booking fee' });
  }
  // Partner overflow booking → share owed to the referring operator, once.
  if (b.attribution?.channel === 'partner' && b.attribution.utmSource?.startsWith('partner:')) {
    const fromTenantId = b.attribution.utmSource.slice('partner:'.length);
    const [ps] = await db.select().from(schema.partnerships).where(and(eq(schema.partnerships.fromTenantId, fromTenantId), eq(schema.partnerships.toTenantId, p.tenantId), eq(schema.partnerships.status, 'active'))).limit(1);
    if (ps) await accrue(db, { kind: 'partner_referral', tenantId: p.tenantId, beneficiaryTenantId: fromTenantId, amountCents: bps(b.subtotalCents, ps.shareBps), bookingId: b.id, sourceRef: `partner:${b.id}`, memo: 'Overflow referral share' });
  }
}

/** Called for each subscription invoice paid (Stripe invoice.paid or demo billing). */
export async function onSubscriptionPaid(p: { tenantId: string; invoiceRef: string; amountCents: number }) {
  const db = await getDb();
  await accrue(db, { kind: 'subscription', tenantId: p.tenantId, amountCents: p.amountCents, sourceRef: p.invoiceRef, memo: 'Subscription' });
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, p.tenantId)).limit(1);
  if (!t?.referredByTenantId) return;
  const monthsSince = (Date.now() - t.createdAt.getTime()) / (30 * 86_400_000);
  if (monthsSince > REFERRAL_MONTHS) return;
  const plan = PLANS[t.plan];
  await accrue(db, { kind: 'referral_commission', tenantId: p.tenantId, beneficiaryTenantId: t.referredByTenantId, amountCents: bps(p.amountCents, plan.referralCommissionBps), sourceRef: `ref:${p.invoiceRef}`, memo: `Referral commission (${plan.referralCommissionBps / 100}% for ${REFERRAL_MONTHS} months)` });
}

/** Managed ads: record spend sync and the management fee. */
export async function onManagedAdSpend(p: { tenantId: string; campaignId: string; periodKey: string; spendCents: number }) {
  const db = await getDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, p.tenantId)).limit(1);
  if (!t) return null;
  return accrue(db, { kind: 'ads_management_fee', tenantId: p.tenantId, amountCents: bps(p.spendCents, PLANS[t.plan].adsManagementBps), sourceRef: `ads:${p.campaignId}:${p.periodKey}`, memo: `Managed ads fee (${PLANS[t.plan].adsManagementBps / 100}% of spend)` });
}

export async function ledgerSummary(sinceDays = 30, tenantId?: string) {
  const db = await getDb();
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const where = tenantId
    ? and(gte(schema.revenueEvents.createdAt, since), sql`(${schema.revenueEvents.tenantId} = ${tenantId} or ${schema.revenueEvents.beneficiaryTenantId} = ${tenantId})`)
    : gte(schema.revenueEvents.createdAt, since);
  return db.select({ kind: schema.revenueEvents.kind, total: sql<number>`coalesce(sum(${schema.revenueEvents.amountCents}),0)::int`, n: sql<number>`count(*)::int` })
    .from(schema.revenueEvents).where(where).groupBy(schema.revenueEvents.kind);
}

/** Earnings an operator is owed (referrals + partner shares). */
export async function operatorEarnings(tenantId: string) {
  const db = await getDb();
  return db.select().from(schema.revenueEvents).where(eq(schema.revenueEvents.beneficiaryTenantId, tenantId)).orderBy(sql`${schema.revenueEvents.createdAt} desc`).limit(200);
}
