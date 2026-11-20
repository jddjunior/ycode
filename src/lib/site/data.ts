/**
 * Storefront data loading. Every query is tenant-scoped.
 * One `SiteCtx` is built per request by the page and handed to SiteLayout.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import type { Tenant } from '../auth';
import type { ThemeTokens } from '../../db/schema';
import { siteOrigin } from '../tenant';
import { THEMES } from '../themes';
import { matchZone } from '../geo';
import { DEFAULT_AGREEMENT } from '../provision';

export type Item = typeof schema.items.$inferSelect;
export type Category = typeof schema.categories.$inferSelect;
export type Page = typeof schema.pages.$inferSelect;
export type Review = typeof schema.reviews.$inferSelect;
export type SiteRow = typeof schema.sites.$inferSelect;

export interface SiteCtx {
  tenant: Tenant;
  /** '' on the tenant's own host; '/sites/{slug}' in platform preview. */
  base: string;
  preview: boolean;
  /** Canonical public origin (may include a path in local dev). */
  origin: string;
  /** Origin that serves /api/public (no path). */
  apiOrigin: string;
  api: string;
  site: SiteRow;
  theme: ThemeTokens;
  categories: Category[];
  items: Item[];
  cities: Page[];
  reviews: Review[];
  catById: Map<string, Category>;
  itemById: Map<string, Item>;
  rating: { avg: number; count: number };
  href: (p: string) => string;
  abs: (p: string) => string;
  itemPath: (i: Item) => string;
}

const fallbackTheme = (): ThemeTokens => {
  const { label: _l, mood: _m, fontsHref: _f, ...t } = THEMES.carnival;
  return t;
};

export async function loadSiteCtx(locals: App.Locals, slugParam?: string): Promise<SiteCtx | null> {
  const s = locals.site;
  if (!s) return null;
  if (slugParam && slugParam !== s.tenant.slug) return null;
  const t = s.tenant;
  const db = await getDb();
  const [[site], categories, items, cities, reviews, origin] = await Promise.all([
    db.select().from(schema.sites).where(eq(schema.sites.tenantId, t.id)).limit(1),
    db.select().from(schema.categories).where(eq(schema.categories.tenantId, t.id)).orderBy(asc(schema.categories.sort), asc(schema.categories.name)),
    db.select().from(schema.items).where(and(eq(schema.items.tenantId, t.id), eq(schema.items.active, true))).orderBy(asc(schema.items.sort), asc(schema.items.name)),
    db.select().from(schema.pages).where(and(eq(schema.pages.tenantId, t.id), eq(schema.pages.kind, 'city'), eq(schema.pages.status, 'published'))).orderBy(asc(schema.pages.title)),
    db.select().from(schema.reviews).where(and(eq(schema.reviews.tenantId, t.id), eq(schema.reviews.featured, true))).orderBy(desc(schema.reviews.createdAt)).limit(50),
    siteOrigin(t),
  ]);
  const base = s.base;
  const siteRow: SiteRow = site ?? {
    tenantId: t.id, theme: fallbackTheme(), nav: [], announcement: null, footerBlurb: '', titleTemplate: '%s | {business}',
    defaultDescription: '', ogImage: null, published: true, updatedAt: new Date(),
  };
  if (!siteRow.published && !base) return null;
  const catById = new Map(categories.map((c) => [c.id, c]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const href = (p: string) => {
    if (/^(https?:|mailto:|tel:|sms:|#)/.test(p)) return p;
    const path = p.startsWith('/') ? p : '/' + p;
    return (base + path).replace(/\/$/, '') || '/';
  };
  const itemPath = (i: Item) => {
    if (i.kind === 'package') return `/rentals/packages/${i.slug}`;
    const c = i.categoryId ? catById.get(i.categoryId) : null;
    return `/rentals/${c?.slug ?? 'item'}/${i.slug}`;
  };
  const rated = reviews.filter((r) => r.rating > 0);
  const avg = rated.length ? rated.reduce((a, r) => a + r.rating, 0) / rated.length : 0;
  const apiOrigin = new URL(origin).origin;
  return {
    tenant: t, base, preview: base !== '', origin, apiOrigin, api: `/api/public/${t.slug}`,
    site: siteRow, theme: siteRow.theme ?? fallbackTheme(),
    categories, items, cities, reviews, catById, itemById,
    rating: { avg: Math.round(avg * 10) / 10, count: rated.length },
    href, abs: (p: string) => origin + (p === '/' ? '/' : p.startsWith('/') ? p : '/' + p), itemPath,
  };
}

export async function loadPage(tenantId: string, slug: string, kinds: Page['kind'][]) {
  const db = await getDb();
  const rows = await db.select().from(schema.pages).where(and(
    eq(schema.pages.tenantId, tenantId), eq(schema.pages.slug, slug), inArray(schema.pages.kind, kinds), eq(schema.pages.status, 'published'),
  )).limit(kinds.length);
  // Prefer the first kind listed.
  return kinds.map((k) => rows.find((r) => r.kind === k)).find(Boolean) ?? null;
}

export async function loadCmsPages(tenantId: string) {
  const db = await getDb();
  return db.select({ slug: schema.pages.slug, kind: schema.pages.kind, title: schema.pages.title, updatedAt: schema.pages.updatedAt })
    .from(schema.pages).where(and(eq(schema.pages.tenantId, tenantId), eq(schema.pages.status, 'published'))).orderBy(asc(schema.pages.slug));
}

export async function deliveryZones(tenantId: string) {
  const db = await getDb();
  return db.select().from(schema.deliveryZones).where(eq(schema.deliveryZones.tenantId, tenantId)).orderBy(asc(schema.deliveryZones.sort));
}

export interface ZoneInfo { known: boolean; deliverable: boolean; name: string | null; feeCents: number; minOrderCents: number }

/** Delivery fee for a ZIP, shown before checkout (research §3 #2). */
export async function zoneForZip(t: Tenant, zip: string): Promise<ZoneInfo> {
  const zones = await deliveryZones(t.id);
  if (!/^\d{5}$/.test(zip)) return { known: false, deliverable: false, name: null, feeCents: 0, minOrderCents: 0 };
  if (!zones.length) return { known: true, deliverable: true, name: null, feeCents: 0, minOrderCents: t.settings?.minOrderCents ?? 0 };
  const z = matchZone(zones, zip, null, t.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : null);
  if (!z) return { known: true, deliverable: false, name: null, feeCents: 0, minOrderCents: 0 };
  return { known: true, deliverable: true, name: z.name, feeCents: z.feeCents, minOrderCents: Math.max(z.minOrderCents, t.settings?.minOrderCents ?? 0) };
}

export const agreementText = (t: Tenant) => t.settings?.rentalAgreement?.trim() || DEFAULT_AGREEMENT;

/** Parse "3-12", "5+", "8+ (adults OK)" → age bounds. */
export function ageBounds(range?: string): { min: number; max: number; adults: boolean } | null {
  if (!range) return null;
  const adults = /adult/i.test(range);
  const m = /(\d+)\s*[-–]\s*(\d+)/.exec(range);
  if (m) return { min: +m[1], max: +m[2], adults: +m[2] >= 18 || adults };
  const p = /(\d+)\s*\+/.exec(range);
  if (p) return { min: +p[1], max: adults ? 120 : 17, adults };
  return null;
}

export function fitsAge(i: Item, age: number) {
  const b = ageBounds(i.specs?.ageRange);
  if (!b) return true;
  if (age >= 18) return b.adults;
  return age >= b.min && age <= b.max;
}

export const AGE_FILTERS = [
  { v: 2, label: 'Toddlers (2–3)' }, { v: 5, label: 'Ages 4–6' }, { v: 9, label: 'Ages 7–11' },
  { v: 14, label: 'Tweens & teens' }, { v: 18, label: 'Adults welcome' },
] as const;

/** Sum of component list prices vs package price. */
export function packageSavings(pkg: Item, byId: Map<string, Item>) {
  const parts = pkg.bundle.map((b) => ({ item: byId.get(b.itemId), qty: b.qty })).filter((x): x is { item: Item; qty: number } => !!x.item);
  const list = parts.reduce((s, p) => s + p.item.priceCents * p.qty, 0);
  return { parts, listCents: list, savingsCents: Math.max(0, list - pkg.priceCents) };
}

export function minPrice(items: Item[]) {
  const p = items.filter((i) => i.kind !== 'package').map((i) => i.priceCents);
  return p.length ? Math.min(...p) : null;
}

export const firstImage = (i: Item) => i.images[0] ?? '/demo/hero.svg';

/** Best-effort "Saturday, Nov 22" for a YYYY-MM-DD day. */
export const prettyDay = (day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' }) =>
  new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));

export const hourLabel = (h: number) => {
  const hh = ((h + 11) % 12) + 1;
  return `${hh}${h < 12 || h === 24 ? 'am' : 'pm'}`;
};

export const telHref = (phone: string) => 'tel:' + phone.replace(/[^\d+]/g, '');
export const smsHref = (phone: string, body?: string) => 'sms:' + phone.replace(/[^\d+]/g, '') + (body ? `?&body=${encodeURIComponent(body)}` : '');

export function depositText(t: Tenant, money: (c: number) => string) {
  const s = t.settings ?? {};
  const dt = s.depositType ?? 'percent';
  if (dt === 'full') return 'Pay in full to reserve';
  if (dt === 'fixed') return `${money(s.depositValue ?? 5000)} deposit holds your date`;
  return `${s.depositValue ?? 25}% deposit holds your date`;
}

/** Facts derived from specs for product FAQs + the fit helper. */
export function itemFacts(i: Item) {
  const s = i.specs ?? {};
  const [aw, al] = (s.setupAreaFt ?? '').split(/\s*x\s*/i).map(Number);
  const area = Number.isFinite(aw) && Number.isFinite(al) && aw > 0 ? { w: aw, l: al } : (s.lengthFt && s.widthFt ? { w: s.widthFt + 4, l: s.lengthFt + 4 } : null);
  return { s, area };
}

/** Earliest/latest bookable day (tenant timezone) for date inputs. */
export function bookableDays(t: Tenant) {
  const s = t.settings ?? {};
  const fmt = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: t.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  return {
    minDay: fmt(Date.now() + (s.leadTimeHours ?? 24) * 3_600_000),
    maxDay: fmt(Date.now() + (s.maxDaysAhead ?? 365) * 86_400_000),
    defaultStart: s.defaultStartHour ?? 10,
    defaultEnd: s.defaultEndHour ?? 18,
  };
}

/** Server-side availability for ?date=&start=&end=&zip= so the catalog is date-first even without JS. */
export async function ssrAvailability(t: Tenant, url: URL) {
  const day = url.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + 'T00:00:00Z'))) return null;
  const { availability, ruleMessage } = await import('../booking');
  const s = t.settings ?? {};
  const h = (k: string, d: number) => { const n = Number.parseInt(url.searchParams.get(k) ?? '', 10); return Number.isFinite(n) && n >= 0 && n <= 24 ? n : d; };
  const startHour = h('start', s.defaultStartHour ?? 10);
  let endHour = h('end', s.defaultEndHour ?? 18);
  if (endHour <= startHour) endHour = Math.min(24, startHour + 6);
  const zip = (url.searchParams.get('zip') ?? '').replace(/\D/g, '').slice(0, 5);
  const [res, zone] = await Promise.all([availability(t, { day, startHour, endHour }), zip.length === 5 ? zoneForZip(t, zip) : Promise.resolve(null)]);
  return { day, startHour, endHour, zip, res, zone, message: res.ok ? null : ruleMessage(res.reason), dayLabel: prettyDay(day, { weekday: 'short', month: 'short', day: 'numeric' }) };
}
