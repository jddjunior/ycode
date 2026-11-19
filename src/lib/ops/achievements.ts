/**
 * Gamification: achievement catalogue + idempotent auto-unlock.
 * Unlocks are stored in the `achievements` table (tenantId, key).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import type { Tenant } from '../auth';
import { FULFIL_STATUSES } from './stops';

export interface AchievementDef { key: string; title: string; text: string; icon: string; tone: string }

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'site_live', title: 'Doors open', text: 'Your booking website went live.', icon: 'globe', tone: 'bg-sky-100 text-sky-700' },
  { key: 'first_booking', title: 'First bounce', text: 'Took your first booking.', icon: 'star', tone: 'bg-sun/40 text-[#7A5200]' },
  { key: 'ten_bookings', title: 'Double digits', text: '10 bookings on the books.', icon: 'calendar', tone: 'bg-brand-soft text-brand' },
  { key: 'fifty_bookings', title: 'Party machine', text: '50 bookings and counting.', icon: 'bolt', tone: 'bg-pop/15 text-[#B23A0B]' },
  { key: 'five_star', title: 'Five-star crew', text: 'Earned a 5-star review.', icon: 'star', tone: 'bg-green-100 text-green-700' },
  { key: 'review_magnet', title: 'Review magnet', text: '10 or more reviews collected.', icon: 'message', tone: 'bg-green-100 text-green-700' },
  { key: 'month_5k', title: '$5K month', text: 'Booked $5,000 in a single month.', icon: 'dollar', tone: 'bg-sun/40 text-[#7A5200]' },
  { key: 'month_10k', title: '$10K month', text: 'Booked $10,000 in a single month.', icon: 'trophy', tone: 'bg-pop/15 text-[#B23A0B]' },
  { key: 'big_weekend', title: 'Big weekend', text: '5+ events on a single day.', icon: 'sparkle', tone: 'bg-brand-soft text-brand' },
  { key: 'repeat_fan', title: 'Repeat fans', text: 'A customer booked a second time.', icon: 'users', tone: 'bg-sky-100 text-sky-700' },
  { key: 'clean_machine', title: 'Clean machine', text: 'Logged 5 cleanings.', icon: 'shield', tone: 'bg-green-100 text-green-700' },
  { key: 'crew_up', title: 'Crew up', text: 'Added a crew member.', icon: 'truck', tone: 'bg-brand-soft text-brand' },
  { key: 'paid_up', title: 'Money in', text: 'Connected online payments.', icon: 'dollar', tone: 'bg-green-100 text-green-700' },
  { key: 'own_domain', title: 'On your own domain', text: 'Verified a custom domain.', icon: 'globe', tone: 'bg-sky-100 text-sky-700' },
];

/** Evaluate rules and insert any newly earned achievements. Returns unlocked keys + their dates. */
export async function syncAchievements(t: Tenant) {
  const db = await getDb();
  const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const B = schema.bookings;
  const [nBookings, nFive, nReviews, bestMonth, bestDay, repeat, cleanings, crew, domains, site] = await Promise.all([
    one(db.select({ n: sql<number>`count(*)::int` }).from(B).where(and(eq(B.tenantId, t.id), inArray(B.status, [...FULFIL_STATUSES])))),
    one(db.select({ n: sql<number>`count(*)::int` }).from(schema.reviews).where(and(eq(schema.reviews.tenantId, t.id), eq(schema.reviews.rating, 5)))),
    one(db.select({ n: sql<number>`count(*)::int` }).from(schema.reviews).where(eq(schema.reviews.tenantId, t.id))),
    one(db.select({ n: sql<number>`coalesce(max(m),0)::int` }).from(sql`(select sum(${B.totalCents}) m from ${B} where ${B.tenantId} = ${t.id} and ${B.status} in ('pending','confirmed','completed') group by date_trunc('month', ${B.startsAt} at time zone ${t.timezone})) x`)),
    one(db.select({ n: sql<number>`coalesce(max(c),0)::int` }).from(sql`(select count(*) c from ${B} where ${B.tenantId} = ${t.id} and ${B.status} in ('pending','confirmed','completed') group by date(${B.startsAt} at time zone ${t.timezone})) x`)),
    one(db.select({ n: sql<number>`count(*)::int` }).from(sql`(select ${B.customerId} from ${B} where ${B.tenantId} = ${t.id} and ${B.status} in ('pending','confirmed','completed') and ${B.customerId} is not null group by ${B.customerId} having count(*) > 1) x`)),
    one(db.select({ n: sql<number>`count(*)::int` }).from(schema.maintenanceLogs).where(and(eq(schema.maintenanceLogs.tenantId, t.id), eq(schema.maintenanceLogs.kind, 'cleaning')))),
    one(db.select({ n: sql<number>`count(*)::int` }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, t.id), eq(schema.memberships.role, 'crew')))),
    one(db.select({ n: sql<number>`count(*)::int` }).from(schema.domains).where(and(eq(schema.domains.tenantId, t.id), eq(schema.domains.verified, true)))),
    one(db.select({ n: sql<number>`count(*)::int` }).from(schema.sites).where(and(eq(schema.sites.tenantId, t.id), eq(schema.sites.published, true)))),
  ]);
  const earned: Record<string, boolean> = {
    site_live: site > 0, first_booking: nBookings >= 1, ten_bookings: nBookings >= 10, fifty_bookings: nBookings >= 50,
    five_star: nFive >= 1, review_magnet: nReviews >= 10, month_5k: bestMonth >= 500_000, month_10k: bestMonth >= 1_000_000,
    big_weekend: bestDay >= 5, repeat_fan: repeat >= 1, clean_machine: cleanings >= 5, crew_up: crew >= 1,
    paid_up: !!t.stripeChargesEnabled, own_domain: domains >= 1,
  };
  const have = await db.select().from(schema.achievements).where(eq(schema.achievements.tenantId, t.id));
  const haveKeys = new Set(have.map((h) => h.key));
  const fresh = Object.entries(earned).filter(([k, v]) => v && !haveKeys.has(k)).map(([k]) => k);
  if (fresh.length) {
    const ins = await db.insert(schema.achievements).values(fresh.map((key) => ({ tenantId: t.id, key }))).onConflictDoNothing().returning();
    if (ins.length) {
      await db.insert(schema.activity).values(ins.map((a) => ({ tenantId: t.id, kind: 'achievement', message: `Achievement unlocked: ${ACHIEVEMENTS.find((x) => x.key === a.key)?.title ?? a.key}`, data: { key: a.key } })));
      have.push(...ins);
    }
  }
  return { unlocked: new Map(have.map((h) => [h.key, h.unlockedAt])), fresh, stats: { nBookings, bestMonth } };
}
