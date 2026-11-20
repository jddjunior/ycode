/**
 * Campaigns + marketing automations.
 *  - Segments resolve to opted-in customers only (email → marketingOptIn, SMS → smsOptIn).
 *  - Review requests: everyone gets the SAME Google review link (no review gating — Google policy).
 *  - Every send goes through notify.send, which logs when no provider is configured.
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { schema, type DB } from '../../db/client';
import type { Tenant } from '../auth';
import { send, merge } from '../notify';
import { siteOrigin } from '../tenant';
import { localDay, addDays, formatLocal } from '../time';

type Customer = typeof schema.customers.$inferSelect;
type Campaign = typeof schema.campaigns.$inferSelect;
export type Segment = Campaign['segment'];

export const CUSTOMER_TYPES = ['residential', 'school', 'church', 'corporate', 'municipal', 'nonprofit'] as const;
export const SEGMENTS: { key: string; label: string }[] = [
  { key: 'all', label: 'All opted-in customers' },
  { key: 'past', label: 'Past customers (completed a booking)' },
  { key: 'dormant', label: 'Haven’t booked in N days' },
  ...CUSTOMER_TYPES.map((t) => ({ key: t, label: `Type: ${t[0].toUpperCase()}${t.slice(1)}` })),
];
export const MERGE_TAGS = ['first_name', 'business', 'book_url', 'celebrant', 'review_url'] as const;

export function segmentLabel(s: Segment) {
  const k = s.type ?? 'all';
  if (k === 'dormant') return `Not booked in ${s.notBookedDays ?? 180} days`;
  return SEGMENTS.find((x) => x.key === k)?.label ?? 'All opted-in customers';
}

/** Opted-in recipients for a segment + channel. Always tenant-scoped. */
export async function segmentCustomers(db: DB, tenantId: string, segment: Segment, channel: 'email' | 'sms', cap = 5000): Promise<Customer[]> {
  const c = schema.customers, b = schema.bookings;
  const conds = [eq(c.tenantId, tenantId), channel === 'email' ? and(eq(c.marketingOptIn, true), sql`${c.email} <> ''`) : and(eq(c.smsOptIn, true), sql`${c.phone} <> ''`)];
  const k = segment.type ?? 'all';
  if (k === 'past') conds.push(sql`exists (select 1 from ${b} where ${b.tenantId} = ${tenantId} and ${b.customerId} = ${c.id} and ${b.status} = 'completed')`);
  if (k === 'dormant') {
    const days = Math.max(1, Math.min(3650, segment.notBookedDays ?? 180));
    const since = new Date(Date.now() - days * 86_400_000);
    conds.push(sql`exists (select 1 from ${b} where ${b.tenantId} = ${tenantId} and ${b.customerId} = ${c.id} and ${b.status} <> 'canceled')`);
    conds.push(sql`not exists (select 1 from ${b} where ${b.tenantId} = ${tenantId} and ${b.customerId} = ${c.id} and ${b.status} <> 'canceled' and ${b.startsAt} >= ${since})`);
  }
  if ((CUSTOMER_TYPES as readonly string[]).includes(k)) conds.push(eq(c.type, k as Customer['type']));
  if (segment.tag) conds.push(sql`${c.tags} @> ${JSON.stringify([segment.tag])}::jsonb`);
  return db.select().from(c).where(and(...conds)).limit(cap);
}

export async function mergeVarsFor(t: Tenant, cust: Pick<Customer, 'name' | 'celebrantName'> | null, opts: { channel: string; campaignId?: string; origin?: string; extra?: Record<string, string> }) {
  const origin = opts.origin ?? await siteOrigin(t);
  const q = new URLSearchParams({ utm_source: 'bounceos', utm_medium: opts.channel, ...(opts.campaignId ? { utm_campaign: opts.campaignId } : {}) });
  return {
    first_name: (cust?.name ?? '').trim().split(/\s+/)[0] || 'there',
    business: t.name,
    book_url: `${origin}/?${q}`,
    celebrant: cust?.celebrantName || 'your little one',
    review_url: t.settings.googleReviewUrl || `${origin}/reviews`,
    ...opts.extra,
  };
}

async function deliver(t: Tenant, camp: Pick<Campaign, 'id' | 'channel' | 'subject' | 'body'>, cust: Customer, origin: string, extra?: Record<string, string>, bookingId?: string) {
  const vars = await mergeVarsFor(t, cust, { channel: camp.channel, campaignId: camp.id, origin, extra });
  return send({
    tenantId: t.id, channel: camp.channel, to: camp.channel === 'email' ? cust.email : cust.phone,
    subject: merge(camp.subject, vars), body: merge(camp.body, vars), campaignId: camp.id, customerId: cust.id, bookingId, fromName: t.name, replyTo: t.email || undefined,
  });
}

/** Send a broadcast now. Returns number of messages queued/logged. */
export async function sendCampaignNow(db: DB, t: Tenant, campaignId: string): Promise<number> {
  const [camp] = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.tenantId, t.id))).limit(1);
  if (!camp || camp.status === 'sending' || camp.status === 'sent' || camp.status === 'automated') return 0;
  // Claim the campaign so concurrent crons/clicks can't double-send.
  const claimed = await db.update(schema.campaigns).set({ status: 'sending' })
    .where(and(eq(schema.campaigns.id, camp.id), eq(schema.campaigns.tenantId, t.id), inArray(schema.campaigns.status, ['draft', 'scheduled']))).returning({ id: schema.campaigns.id });
  if (!claimed.length) return 0;
  const origin = await siteOrigin(t);
  const people = await segmentCustomers(db, t.id, camp.segment, camp.channel);
  let n = 0;
  for (const p of people) { const m = await deliver(t, camp, p, origin); if (m.status !== 'failed') n++; }
  await db.update(schema.campaigns).set({ status: 'sent', sentCount: sql`${schema.campaigns.sentCount} + ${n}`, scheduledAt: camp.scheduledAt ?? new Date() }).where(eq(schema.campaigns.id, camp.id));
  return n;
}

/* ───────────── Automations ───────────── */

export type AutoKind = 'birthday' | 'review' | 'abandoned' | 'seasonal';
export const AUTOMATIONS: { kind: AutoKind; name: string; channel: 'email' | 'sms'; when: string; subject: string; body: string }[] = [
  { kind: 'birthday', name: 'Birthday re-book (30 days before)', channel: 'email', when: '30 days before each celebrant’s birthday', subject: '{{celebrant}}’s birthday is coming up 🎈', body: 'Hi {{first_name}},\n\n{{celebrant}}’s birthday is about a month away! Want to make it a bounce-house birthday again? Weekend dates go fast.\n\nCheck your date: {{book_url}}\n\n— {{business}}' },
  { kind: 'review', name: 'Review request (day after)', channel: 'sms', when: 'The day after a completed booking', subject: 'How was your party?', body: 'Thanks for partying with {{business}}, {{first_name}}! Would you leave us a quick Google review? {{review_url}}' },
  { kind: 'abandoned', name: 'Abandoned checkout follow-up', channel: 'email', when: '1 hour and 24 hours after an unfinished checkout', subject: 'Still planning your party?', body: 'Hi {{first_name}}, your {{item}} is still available for {{event_date}} — but weekends fill fast. Finish booking: {{book_url}}\n\n— {{business}}' },
  { kind: 'seasonal', name: 'Seasonal water-slide promo', channel: 'email', when: 'Once each spring (Apr–Jun) to opted-in customers', subject: 'Water slide season is here ☀️', body: 'Hi {{first_name}},\n\nHouston-hot weekends are coming. Our water slides and wet/dry combos book out first — grab your date now: {{book_url}}\n\n— {{business}}' },
];

/** Make sure each automation has a campaign row (status 'draft' = off, 'automated' = on). */
export async function ensureAutomations(db: DB, tenantId: string) {
  const rows = await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.tenantId, tenantId), inArray(schema.campaigns.kind, AUTOMATIONS.map((a) => a.kind))));
  const missing = AUTOMATIONS.filter((a) => !rows.some((r) => r.kind === a.kind));
  if (missing.length) {
    await db.insert(schema.campaigns).values(missing.map((a) => ({ tenantId, name: a.name, channel: a.channel, kind: a.kind, subject: a.subject, body: a.body, status: 'draft' as const })));
    return db.select().from(schema.campaigns).where(and(eq(schema.campaigns.tenantId, tenantId), inArray(schema.campaigns.kind, AUTOMATIONS.map((a) => a.kind))));
  }
  return rows;
}

async function alreadySent(db: DB, campaignId: string, customerId: string, withinDays: number) {
  const [hit] = await db.select({ id: schema.messages.id }).from(schema.messages)
    .where(and(eq(schema.messages.campaignId, campaignId), eq(schema.messages.customerId, customerId), gte(schema.messages.createdAt, new Date(Date.now() - withinDays * 86_400_000)))).limit(1);
  return !!hit;
}
const bump = (db: DB, id: string, n: number) => n ? db.update(schema.campaigns).set({ sentCount: sql`${schema.campaigns.sentCount} + ${n}` }).where(eq(schema.campaigns.id, id)) : null;

export async function runBirthday(db: DB, t: Tenant, camp: Campaign, now = new Date()) {
  const today = localDay(now, t.timezone);
  const target = addDays(today, 30).slice(5); // MM-DD, 30 days out
  const window = [target, addDays(today, 29).slice(5), addDays(today, 28).slice(5)]; // tolerate a missed cron day or two
  const optIn = camp.channel === 'email' ? eq(schema.customers.marketingOptIn, true) : eq(schema.customers.smsOptIn, true);
  const people = await db.select().from(schema.customers).where(and(eq(schema.customers.tenantId, t.id), optIn,
    sql`${schema.customers.celebrantBirthday} is not null and to_char(${schema.customers.celebrantBirthday}, 'MM-DD') in (${sql.join(window.map((w) => sql`${w}`), sql`, `)})`)).limit(2000);
  const origin = await siteOrigin(t);
  let n = 0;
  for (const p of people) {
    if ((camp.channel === 'email' ? !p.email : !p.phone) || await alreadySent(db, camp.id, p.id, 300)) continue;
    if ((await deliver(t, camp, p, origin)).status !== 'failed') n++;
  }
  await bump(db, camp.id, n);
  return n;
}

/**
 * Review requests to completed bookings. Cron sends the day after (≥20h after end);
 * the manual button passes { minHoursAfter: 0, maxDays: 30 }. Same link for everyone.
 */
export async function runReviewRequests(db: DB, t: Tenant, camp: Pick<Campaign, 'id' | 'channel' | 'subject' | 'body'>, opts: { minHoursAfter?: number; maxDays?: number } = {}) {
  const now = Date.now();
  const rows = await db.select({ b: schema.bookings, c: schema.customers }).from(schema.bookings)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.bookings.customerId))
    .where(and(eq(schema.bookings.tenantId, t.id), eq(schema.customers.tenantId, t.id), eq(schema.bookings.status, 'completed'), isNull(schema.bookings.reviewRequestedAt),
      lte(schema.bookings.endsAt, new Date(now - (opts.minHoursAfter ?? 20) * 3_600_000)), gte(schema.bookings.endsAt, new Date(now - (opts.maxDays ?? 14) * 86_400_000)))).limit(500);
  const origin = await siteOrigin(t);
  let n = 0;
  for (const { b, c } of rows) {
    // SMS needs SMS consent; otherwise fall back to email (transactional follow-up).
    const channel: 'email' | 'sms' = camp.channel === 'sms' && c.smsOptIn && c.phone ? 'sms' : 'email';
    if (channel === 'email' && !c.email) continue;
    const vars = await mergeVarsFor(t, c, { channel, campaignId: camp.id, origin });
    const m = await send({ tenantId: t.id, channel, to: channel === 'email' ? c.email : c.phone, subject: merge(camp.subject || 'How was your party?', vars), body: merge(camp.body, vars), campaignId: camp.id, customerId: c.id, bookingId: b.id, fromName: t.name });
    await db.update(schema.bookings).set({ reviewRequestedAt: new Date() }).where(and(eq(schema.bookings.id, b.id), eq(schema.bookings.tenantId, t.id)));
    if (m.status !== 'failed') n++;
  }
  if (camp.id) await bump(db, camp.id, n);
  return n;
}

export async function runAbandoned(db: DB, t: Tenant, camp: Campaign, now = new Date()) {
  const L = schema.leads;
  const leads = await db.select().from(L).where(and(eq(L.tenantId, t.id), eq(L.source, 'abandoned_checkout'), eq(L.stage, 'new'), sql`${L.email} <> ''`,
    gte(L.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
    sql`((${L.followUpsSent} = 0 and ${L.createdAt} <= ${new Date(now.getTime() - 3_600_000)}) or (${L.followUpsSent} = 1 and ${L.createdAt} <= ${new Date(now.getTime() - 24 * 3_600_000)}))`)).limit(500);
  if (!leads.length) return 0;
  const origin = await siteOrigin(t);
  const itemIds = [...new Set(leads.flatMap((l) => l.cart.map((c) => c.itemId)))];
  const names = new Map((itemIds.length ? await db.select({ id: schema.items.id, name: schema.items.name }).from(schema.items).where(and(eq(schema.items.tenantId, t.id), inArray(schema.items.id, itemIds))) : []).map((i) => [i.id, i.name]));
  let n = 0;
  for (const l of leads) {
    // Stop if they booked after abandoning.
    const [booked] = await db.select({ id: schema.bookings.id }).from(schema.bookings).innerJoin(schema.customers, eq(schema.customers.id, schema.bookings.customerId))
      .where(and(eq(schema.bookings.tenantId, t.id), sql`lower(${schema.customers.email}) = lower(${l.email})`, gte(schema.bookings.createdAt, l.createdAt), sql`${schema.bookings.status} <> 'hold'`)).limit(1);
    if (booked) { await db.update(L).set({ stage: 'won' }).where(and(eq(L.id, l.id), eq(L.tenantId, t.id))); continue; }
    // Unsubscribed past customers don't get marketing follow-ups.
    const [cust] = await db.select().from(schema.customers).where(and(eq(schema.customers.tenantId, t.id), sql`lower(${schema.customers.email}) = lower(${l.email})`)).limit(1);
    if (cust && !cust.marketingOptIn && cust.lifetimeValueCents > 0) continue;
    const item = l.cart.map((c) => names.get(c.itemId)).filter(Boolean)[0] ?? 'party rental';
    const eventDate = l.eventDate ? formatLocal(new Date(l.eventDate + 'T12:00:00Z'), 'UTC', { weekday: 'long', month: 'long', day: 'numeric' }) : 'your date';
    const vars = await mergeVarsFor(t, { name: l.name, celebrantName: null }, { channel: 'email', campaignId: camp.id, origin, extra: { item, event_date: eventDate } });
    const follow = l.followUpsSent === 0 ? '' : 'Last reminder: ';
    const m = await send({ tenantId: t.id, channel: 'email', to: l.email, subject: follow + merge(camp.subject, vars), body: merge(camp.body, vars), campaignId: camp.id, customerId: cust?.id, fromName: t.name });
    await db.update(L).set({ followUpsSent: l.followUpsSent + 1, lastFollowUpAt: new Date(), stage: l.followUpsSent + 1 >= 2 ? 'contacted' : 'new' }).where(and(eq(L.id, l.id), eq(L.tenantId, t.id)));
    if (m.status !== 'failed') n++;
  }
  await bump(db, camp.id, n);
  return n;
}

export async function runSeasonal(db: DB, t: Tenant, camp: Campaign, now = new Date()) {
  const month = Number(localDay(now, t.timezone).slice(5, 7));
  if (month < 4 || month > 6) return 0;
  const people = await segmentCustomers(db, t.id, { type: 'all' }, camp.channel, 500);
  const origin = await siteOrigin(t);
  let n = 0;
  for (const p of people) {
    if (await alreadySent(db, camp.id, p.id, 300)) continue;
    if ((await deliver(t, camp, p, origin)).status !== 'failed') n++;
  }
  await bump(db, camp.id, n);
  return n;
}

export async function recentCampaignMessages(db: DB, tenantId: string, campaignId: string, limit = 20) {
  return db.select().from(schema.messages).where(and(eq(schema.messages.tenantId, tenantId), eq(schema.messages.campaignId, campaignId))).orderBy(desc(schema.messages.createdAt)).limit(limit);
}
