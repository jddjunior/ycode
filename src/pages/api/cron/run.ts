/**
 * POST /api/cron/run — the platform heartbeat. Idempotent; safe to run every 5–15 minutes.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`. Refuses when CRON_SECRET is unset or wrong.
 *
 * Railway setup (one extra service, no code changes):
 *   1. In the BounceOS project, New → Empty Service, name it "cron".
 *   2. Variables: CRON_SECRET=${{web.CRON_SECRET}} and APP_URL=${{web.RAILWAY_PUBLIC_DOMAIN}}
 *      (set CRON_SECRET on the web service too — a long random string, e.g. `openssl rand -hex 32`).
 *   3. Settings → Deploy → Cron Schedule: `*\/10 * * * *` (every 10 minutes, UTC).
 *   4. Start command:
 *        curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://$APP_URL/api/cron/run
 *   Railway runs the service on schedule and it exits after the request. Logs show the JSON counts.
 *
 * Jobs (each tenant-scoped, errors isolated per tenant and per job):
 *   - expire stale holds (status 'hold' past holdExpiresAt → 'canceled')
 *   - send due scheduled campaigns
 *   - automations: birthday re-book, review requests (day after), abandoned checkout (1h / 24h), seasonal promo
 *   - publish due social posts via the network adapters
 *   - unlock achievements
 */
import type { APIRoute } from 'astro';
import { and, eq, isNotNull, lte, ne } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { getDb, schema } from '../../../db/client';
import { sendCampaignNow, ensureAutomations, runBirthday, runReviewRequests, runAbandoned, runSeasonal } from '../../../lib/growth/campaigns';
import { publishPost } from '../../../lib/growth/social';
import { unlockAchievements } from '../../../lib/growth/achievements';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

let running = false;

export const POST: APIRoute = async ({ request }) => {
  if (!process.env.CRON_SECRET) return json({ error: 'CRON_SECRET is not configured' }, 503);
  if (!authorized(request)) return json({ error: 'unauthorized' }, 401);
  if (running) return json({ ok: true, skipped: 'already running' }, 202);
  running = true;
  const started = Date.now();
  const counts = { holdsExpired: 0, campaignsSent: 0, campaignMessages: 0, birthday: 0, reviewRequests: 0, abandoned: 0, seasonal: 0, socialPublished: 0, socialFailed: 0, socialManualDue: 0, achievements: 0, tenants: 0 };
  const errors: { tenant?: string; job: string; error: string }[] = [];
  const guard = async (job: string, tenant: string | undefined, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { errors.push({ tenant, job, error: (e as Error).message.slice(0, 200) }); }
  };
  try {
    const db = await getDb();
    const now = new Date();

    await guard('holds', undefined, async () => {
      const expired = await db.update(schema.bookings).set({ status: 'canceled', updatedAt: now })
        .where(and(eq(schema.bookings.status, 'hold'), isNotNull(schema.bookings.holdExpiresAt), lte(schema.bookings.holdExpiresAt, now))).returning({ id: schema.bookings.id });
      counts.holdsExpired = expired.length;
    });

    const tenants = await db.select().from(schema.tenants).where(ne(schema.tenants.status, 'canceled'));
    counts.tenants = tenants.length;
    for (const t of tenants) {
      await guard('campaigns', t.slug, async () => {
        const due = await db.select({ id: schema.campaigns.id }).from(schema.campaigns)
          .where(and(eq(schema.campaigns.tenantId, t.id), eq(schema.campaigns.status, 'scheduled'), lte(schema.campaigns.scheduledAt, now)));
        for (const c of due) { const n = await sendCampaignNow(db, t, c.id); counts.campaignsSent++; counts.campaignMessages += n; }
      });

      const autos = (await ensureAutomations(db, t.id)).filter((a) => a.status === 'automated');
      for (const a of autos) {
        await guard(`automation:${a.kind}`, t.slug, async () => {
          if (a.kind === 'birthday') counts.birthday += await runBirthday(db, t, a, now);
          if (a.kind === 'review') counts.reviewRequests += await runReviewRequests(db, t, a);
          if (a.kind === 'abandoned') counts.abandoned += await runAbandoned(db, t, a, now);
          if (a.kind === 'seasonal') counts.seasonal += await runSeasonal(db, t, a, now);
        });
      }

      await guard('social', t.slug, async () => {
        const posts = await db.select().from(schema.socialPosts)
          .where(and(eq(schema.socialPosts.tenantId, t.id), eq(schema.socialPosts.status, 'scheduled'), lte(schema.socialPosts.scheduledAt, now))).limit(50);
        for (const p of posts) {
          const r = await publishPost(t, p);
          if (r.status === 'scheduled') { counts.socialManualDue++; continue; } // manual-only: stays in the queue as "Due now"
          await db.update(schema.socialPosts).set({ status: r.status, publishedAt: r.status === 'published' ? now : null, result: r.results })
            .where(and(eq(schema.socialPosts.id, p.id), eq(schema.socialPosts.tenantId, t.id)));
          if (r.status === 'published') counts.socialPublished++; else counts.socialFailed++;
        }
      });

      await guard('achievements', t.slug, async () => { counts.achievements += (await unlockAchievements(db, t.id)).length; });
    }
    return json({ ok: errors.length === 0, ms: Date.now() - started, counts, errors });
  } finally {
    running = false;
  }
};

export const GET: APIRoute = () => json({ error: 'use POST' }, 405);
