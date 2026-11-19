/**
 * SEO helpers: JSON-LD builders and an on-page SEO scorer.
 * Patterns from docs/research/02-website-patterns.md:
 *  - titles: "{Size}ft {Theme} {Type} Rental {City} {ST}", review count in title
 *  - Product + Offer schema with availability; LocalBusiness per site;
 *    no self-serving review stars on LocalBusiness (Google ignores/penalises).
 */
import type { Tenant } from './auth';
import type { schema } from '../db/client';

type Item = typeof schema.items.$inferSelect;
type Page = typeof schema.pages.$inferSelect;

export function localBusinessLd(t: Tenant, origin: string, opts: { cities?: string[]; logo?: string | null; sameAs?: string[] } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'EntertainmentBusiness'],
    '@id': `${origin}/#business`,
    name: t.name, url: origin + '/', telephone: t.phone || undefined, email: t.email || undefined,
    image: opts.logo ?? t.logoUrl ?? undefined,
    priceRange: '$$',
    address: t.city ? { '@type': 'PostalAddress', addressLocality: t.city, addressRegion: t.state, postalCode: t.zip, addressCountry: 'US', streetAddress: t.addressLine || undefined } : undefined,
    geo: t.lat != null && t.lng != null ? { '@type': 'GeoCoordinates', latitude: t.lat, longitude: t.lng } : undefined,
    areaServed: opts.cities?.map((c) => ({ '@type': 'City', name: c })),
    sameAs: opts.sameAs?.length ? opts.sameAs : undefined,
  };
}

export function productLd(item: Item, origin: string, url: string, t: Tenant, availableUnits?: number) {
  const s = item.specs ?? {};
  const props = [
    s.lengthFt && s.widthFt && { name: 'Footprint', value: `${s.lengthFt} x ${s.widthFt} ft` },
    s.heightFt && { name: 'Height', value: `${s.heightFt} ft` },
    s.ageRange && { name: 'Ages', value: s.ageRange },
    s.maxRiders && { name: 'Max riders', value: String(s.maxRiders) },
    s.outlets && { name: 'Power', value: `${s.outlets} x 110v outlet` },
  ].filter(Boolean).map((p) => ({ '@type': 'PropertyValue', ...(p as object) }));
  return {
    '@context': 'https://schema.org', '@type': 'Product',
    name: item.name, description: item.seoDescription ?? item.tagline ?? item.description.slice(0, 160),
    image: item.images.map((i) => (i.startsWith('http') ? i : origin + i)),
    sku: item.id, brand: { '@type': 'Brand', name: t.name },
    additionalProperty: props.length ? props : undefined,
    offers: {
      '@type': 'Offer', url, priceCurrency: 'USD', price: (item.priceCents / 100).toFixed(2),
      availability: availableUnits === 0 ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
      seller: { '@id': `${origin}/#business` },
    },
  };
}

export const breadcrumbLd = (crumbs: { name: string; url: string }[]) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
});

export const faqLd = (faqs: { q: string; a: string }[]) => faqs.length ? ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
}) : null;

export function itemTitle(item: Item, city: string, state: string) {
  if (item.seoTitle) return item.seoTitle;
  const s = item.specs ?? {};
  const size = s.heightFt && /slide/i.test(item.name) ? `${s.heightFt}ft ` : '';
  return `${size}${item.name} Rental ${city} ${state}`.replace(/\s+/g, ' ').trim();
}

export function applyTitle(template: string, title: string, business: string) {
  const t = template.replace('{business}', business);
  const full = t.includes('%s') ? t.replace('%s', title) : `${title} | ${t}`;
  return full.length > 65 && title.length <= 65 ? title : full;
}

/* ───────────── On-page scorer ───────────── */

export interface SeoCheck { key: string; label: string; ok: boolean; weight: number; tip: string }

export function scorePage(p: { title: string; description: string; h1: string; bodyText: string; hasSchema: boolean; images: { alt: string }[]; internalLinks: number; keyword?: string; city?: string }): { score: number; checks: SeoCheck[] } {
  const kw = (p.keyword ?? '').toLowerCase();
  const words = p.bodyText.split(/\s+/).filter(Boolean).length;
  const checks: SeoCheck[] = [
    { key: 'title_len', label: 'Title is 30–65 characters', ok: p.title.length >= 30 && p.title.length <= 65, weight: 12, tip: `Currently ${p.title.length} chars. Lead with the service + city.` },
    { key: 'desc_len', label: 'Meta description is 110–160 characters', ok: p.description.length >= 110 && p.description.length <= 160, weight: 10, tip: `Currently ${p.description.length} chars. Include a call to action.` },
    { key: 'h1', label: 'Has a single clear H1', ok: p.h1.trim().length >= 10, weight: 10, tip: 'Use one H1 that names the service and city.' },
    { key: 'kw_title', label: 'Target keyword in title', ok: !kw || p.title.toLowerCase().includes(kw), weight: 12, tip: `Add "${p.keyword}" to the title.` },
    { key: 'city', label: 'City mentioned in title or H1', ok: !p.city || (p.title + p.h1).toLowerCase().includes(p.city.toLowerCase()), weight: 10, tip: 'Local intent: name the city.' },
    { key: 'words', label: 'At least 300 words of unique content', ok: words >= 300, weight: 14, tip: `Currently ~${words} words. Add local details, FAQs, and logistics (permits, parks, delivery).` },
    { key: 'schema', label: 'Structured data present', ok: p.hasSchema, weight: 12, tip: 'Add LocalBusiness / Product / FAQ JSON-LD.' },
    { key: 'alt', label: 'All images have alt text', ok: p.images.every((i) => i.alt.trim().length > 3), weight: 8, tip: 'Describe each photo (e.g. "Unicorn bounce house set up in a backyard").' },
    { key: 'links', label: '3+ internal links', ok: p.internalLinks >= 3, weight: 12, tip: 'Link to categories, products and nearby city pages.' },
  ];
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0);
  return { score: Math.round((got / total) * 100), checks };
}

export function pageText(page: Page): string {
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(page.blocks.map((b) => b.props));
  if (page.local) walk(page.local);
  return parts.join(' ').replace(/<[^>]+>/g, ' ');
}
