/** Milestones that make running the business more fun. Idempotent: (tenantId, key) is the PK. */
import { and, eq, sql } from 'drizzle-orm';
import { schema, type DB } from '../../db/client';

export const ACHIEVEMENTS: { key: string; label: string; icon: string; test: (s: Stats) => boolean }[] = [
  { key: 'first_booking', label: 'First booking', icon: 'calendar', test: (s) => s.bookings >= 1 },
  { key: 'ten_bookings', label: '10 bookings', icon: 'trophy', test: (s) => s.bookings >= 10 },
  { key: 'fifty_bookings', label: '50 bookings', icon: 'trophy', test: (s) => s.bookings >= 50 },
  { key: 'five_star', label: 'First 5-star review', icon: 'star', test: (s) => s.fiveStars >= 1 },
  { key: 'five_five_stars', label: 'Five 5-star reviews', icon: 'star', test: (s) => s.fiveStars >= 5 },
  { key: 'local_legend', label: '5 city pages live', icon: 'map', test: (s) => s.cityPages >= 5 },
  { key: 'first_campaign', label: 'First campaign sent', icon: 'megaphone', test: (s) => s.campaignsSent >= 1 },
  { key: 'social_starter', label: 'First social post published', icon: 'share', test: (s) => s.postsPublished >= 1 },
  { key: 'team_player', label: 'First overflow partner', icon: 'users', test: (s) => s.partners >= 1 },
];
interface Stats { bookings: number; fiveStars: number; cityPages: number; campaignsSent: number; postsPublished: number; partners: number }

export async function unlockAchievements(db: DB, tenantId: string): Promise<string[]> {
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const c = sql<number>`count(*)::int`;
  const stats: Stats = {
    bookings: await n(db.select({ n: c }).from(schema.bookings).where(and(eq(schema.bookings.tenantId, tenantId), sql`${schema.bookings.status} in ('pending','confirmed','completed')`))),
    fiveStars: await n(db.select({ n: c }).from(schema.reviews).where(and(eq(schema.reviews.tenantId, tenantId), eq(schema.reviews.rating, 5)))),
    cityPages: await n(db.select({ n: c }).from(schema.pages).where(and(eq(schema.pages.tenantId, tenantId), eq(schema.pages.kind, 'city'), eq(schema.pages.status, 'published')))),
    campaignsSent: await n(db.select({ n: c }).from(schema.campaigns).where(and(eq(schema.campaigns.tenantId, tenantId), sql`${schema.campaigns.sentCount} > 0`))),
    postsPublished: await n(db.select({ n: c }).from(schema.socialPosts).where(and(eq(schema.socialPosts.tenantId, tenantId), eq(schema.socialPosts.status, 'published')))),
    partners: await n(db.select({ n: c }).from(schema.partnerships).where(and(sql`(${schema.partnerships.fromTenantId} = ${tenantId} or ${schema.partnerships.toTenantId} = ${tenantId})`, eq(schema.partnerships.status, 'active')))),
  };
  const due = ACHIEVEMENTS.filter((a) => a.test(stats));
  if (!due.length) return [];
  const rows = await db.insert(schema.achievements).values(due.map((a) => ({ tenantId, key: a.key }))).onConflictDoNothing().returning({ key: schema.achievements.key });
  if (rows.length) {
    await db.insert(schema.activity).values(rows.map((r) => ({ tenantId, kind: 'achievement', message: `🏆 Achievement unlocked: ${ACHIEVEMENTS.find((a) => a.key === r.key)?.label}`, data: { key: r.key } })));
  }
  return rows.map((r) => r.key);
}
