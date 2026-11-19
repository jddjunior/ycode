/** BounceOS consumer marketplace (/find): match listed operators to a ZIP and route quote requests. */
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import type { Tenant } from '../auth';
import { siteOrigin, platformUrl } from '../tenant';
import { send } from '../notify';

const PLAN_RANK = sql`case ${schema.tenants.plan} when 'elite' then 0 when 'pro' then 1 else 2 end`;

export interface MarketOperator {
  tenant: Tenant; origin: string; storefront: string; deliveryFeeCents: number;
  rating: number | null; reviewCount: number;
  items: { name: string; slug: string; image: string | null; priceCents: number; url: string }[];
}

export const marketUtm = (zip: string) => new URLSearchParams({ utm_source: 'bounceos', utm_medium: 'marketplace', utm_campaign: `find-${zip}` }).toString();

/** Listed, non-canceled operators whose delivery zones include this ZIP (or who are based in it). */
export async function operatorsForZip(zip: string, limit = 12): Promise<MarketOperator[]> {
  if (!/^\d{5}$/.test(zip)) return [];
  const db = await getDb();
  const T = schema.tenants, Z = schema.deliveryZones;
  const rows = await db.select({ t: T, fee: sql<number>`min(${Z.feeCents})::int` }).from(T)
    .leftJoin(Z, and(eq(Z.tenantId, T.id), sql`${Z.zips} @> ${JSON.stringify([zip])}::jsonb`))
    .where(and(eq(T.marketplaceListed, true), ne(T.status, 'canceled'), sql`(${Z.id} is not null or ${T.zip} = ${zip})`))
    .groupBy(T.id).orderBy(PLAN_RANK, desc(T.createdAt)).limit(limit);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.t.id);
  const stats = new Map((await db.select({ id: schema.reviews.tenantId, avg: sql<number>`avg(${schema.reviews.rating})::float`, n: sql<number>`count(*)::int` })
    .from(schema.reviews).where(inArray(schema.reviews.tenantId, ids)).groupBy(schema.reviews.tenantId)).map((s) => [s.id, s]));
  const items = await db.select({ tenantId: schema.items.tenantId, name: schema.items.name, slug: schema.items.slug, images: schema.items.images, priceCents: schema.items.priceCents, featured: schema.items.featured })
    .from(schema.items).where(and(inArray(schema.items.tenantId, ids), eq(schema.items.active, true), ne(schema.items.kind, 'addon')))
    .orderBy(desc(schema.items.featured), schema.items.sort);
  const q = marketUtm(zip);
  const out: MarketOperator[] = [];
  for (const r of rows) {
    const origin = await siteOrigin(r.t);
    const st = stats.get(r.t.id);
    out.push({
      tenant: r.t, origin, storefront: `${origin}/?${q}`, deliveryFeeCents: r.fee ?? 0,
      rating: st ? Math.round(st.avg * 10) / 10 : null, reviewCount: st?.n ?? 0,
      items: items.filter((i) => i.tenantId === r.t.id).slice(0, 3).map((i) => ({ name: i.name, slug: i.slug, image: i.images[0] ?? null, priceCents: i.priceCents, url: `${origin}/rentals/${i.slug}?${q}` })),
    });
  }
  // Better-reviewed operators first within the same plan tier.
  return out.sort((a, b) => (PLAN_ORDER[a.tenant.plan] - PLAN_ORDER[b.tenant.plan]) || ((b.rating ?? 0) * Math.log1p(b.reviewCount) - (a.rating ?? 0) * Math.log1p(a.reviewCount)));
}
const PLAN_ORDER: Record<string, number> = { elite: 0, pro: 1, starter: 2 };

export interface QuoteRequest { name: string; email: string; phone: string; zip: string; eventDate: string; guests: number | null; wants: string[]; message: string }

/** Create a marketplace lead, route it to up to 3 matching operators, notify them. */
export async function routeQuoteRequest(req: QuoteRequest) {
  const db = await getDb();
  const ops = (await operatorsForZip(req.zip, 12)).slice(0, 3);
  const [ml] = await db.insert(schema.marketplaceLeads).values({ ...req, routedTenantIds: ops.map((o) => o.tenant.id) }).returning();
  const summary = [req.wants.length ? `Wants: ${req.wants.join(', ')}` : '', req.guests ? `Guests: ${req.guests}` : '', req.message].filter(Boolean).join('\n');
  for (const o of ops) {
    await db.insert(schema.leads).values({
      tenantId: o.tenant.id, name: req.name, email: req.email, phone: req.phone, eventDate: req.eventDate, zip: req.zip,
      message: `BounceOS marketplace quote request.\n${summary}`.trim(), source: 'marketplace', marketplaceLeadId: ml.id, stage: 'new',
      attribution: { channel: 'marketplace', utmSource: 'bounceos', utmMedium: 'marketplace', utmCampaign: `find-${req.zip}` },
    });
    if (o.tenant.email) {
      await send({
        tenantId: o.tenant.id, channel: 'email', to: o.tenant.email, subject: `New quote request for ${req.eventDate} (${req.zip})`,
        body: `A family near ${req.zip} wants a quote from you on the BounceOS marketplace.\n\nName: ${req.name}\nEmail: ${req.email}\nPhone: ${req.phone || '—'}\nEvent date: ${req.eventDate}\n${summary}\n\nThey asked up to ${ops.length} operators — the first friendly reply usually wins. Open the lead: ${platformUrl()}/app/customers\n\nMarketplace fee applies only if this turns into a booking.`,
      });
    }
  }
  return { lead: ml, operators: ops };
}
