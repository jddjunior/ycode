/**
 * Host → tenant resolution.
 *   PLATFORM_HOSTS     comma list served the BounceOS app + marketing (default localhost, 127.0.0.1)
 *   SITES_BASE_DOMAIN  wildcard base for free operator sites: {slug}.{SITES_BASE_DOMAIN}
 *   Custom domains     verified rows in `domains`
 * Local dev: {slug}.localhost:4321 works in all modern browsers, and
 * /sites/{slug}/… previews any site on the platform host.
 */
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import type { Tenant } from './auth';

const TTL = 30_000;
const cache = new Map<string, { at: number; v: Tenant | null }>();

export const sitesBaseDomain = () => (process.env.SITES_BASE_DOMAIN ?? 'localhost').toLowerCase();
export const platformHosts = () =>
  (process.env.PLATFORM_HOSTS ?? 'localhost,127.0.0.1').toLowerCase().split(',').map((h) => h.trim()).filter(Boolean);

export const platformUrl = () => (process.env.PUBLIC_APP_URL ?? 'http://localhost:4321').replace(/\/$/, '');

function hostOnly(host: string) { return host.toLowerCase().replace(/:\d+$/, ''); }

export function isPlatformHost(host: string) {
  const h = hostOnly(host);
  return platformHosts().includes(h) || h.endsWith('.railway.app') && !h.startsWith('sites-');
}

/** Returns the slug candidate if host is `{slug}.{base}`. */
export function subdomainSlug(host: string): string | null {
  const h = hostOnly(host), base = sitesBaseDomain();
  if (!h.endsWith('.' + base)) return null;
  const sub = h.slice(0, -(base.length + 1));
  if (!sub || sub.includes('.') || sub === 'www' || sub === 'app') return null;
  return sub;
}

async function memo(key: string, load: () => Promise<Tenant | null>) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const v = await load();
  cache.set(key, { at: Date.now(), v });
  return v;
}

export function invalidateTenantCache() { cache.clear(); }

export async function tenantBySlug(slug: string): Promise<Tenant | null> {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  return memo('slug:' + slug, async () => {
    const db = await getDb();
    const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1);
    return t ?? null;
  });
}

export async function tenantByHost(host: string): Promise<Tenant | null> {
  if (isPlatformHost(host)) return null;
  const sub = subdomainSlug(host);
  if (sub) return tenantBySlug(sub);
  const h = hostOnly(host).replace(/^www\./, '');
  return memo('host:' + h, async () => {
    const db = await getDb();
    const [row] = await db.select({ t: schema.tenants }).from(schema.domains)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.domains.tenantId))
      .where(and(eq(schema.domains.hostname, h), eq(schema.domains.verified, true))).limit(1);
    return row?.t ?? null;
  });
}

/** Canonical public origin of a tenant site. */
export async function siteOrigin(t: Tenant): Promise<string> {
  const db = await getDb();
  const [d] = await db.select().from(schema.domains)
    .where(and(eq(schema.domains.tenantId, t.id), eq(schema.domains.isPrimary, true), eq(schema.domains.verified, true))).limit(1);
  if (d) return `https://${d.hostname}`;
  const base = sitesBaseDomain();
  if (base === 'localhost') return `${platformUrl()}/sites/${t.slug}`;
  return `https://${t.slug}.${base}`;
}
