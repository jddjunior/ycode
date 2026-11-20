/** Score a CMS page the way Google sees the rendered storefront page (estimated from blocks). */
import { scorePage, pageText, applyTitle, type SeoCheck } from '../seo';
import type { schema } from '../../db/client';
import type { Tenant } from '../auth';

type Page = typeof schema.pages.$inferSelect;
type Site = typeof schema.sites.$inferSelect;

export interface PageScore { score: number; checks: SeoCheck[]; title: string; description: string; keyword?: string; city?: string }

export function scoreCmsPage(page: Page, site: Site | undefined, t: Tenant, ctx: { cityCount: number; categoryCount: number }): PageScore {
  const title = applyTitle(site?.titleTemplate ?? '%s | {business}', page.seoTitle ?? page.title, t.name);
  const description = page.seoDescription ?? site?.defaultDescription ?? '';
  const hero = page.blocks.find((b) => b.type === 'hero');
  const h1 = String(hero?.props.headline ?? page.title);
  const images = page.blocks.filter((b) => typeof b.props.image === 'string' && b.props.image).map((b) => ({ alt: String(b.props.imageAlt ?? '') }));
  let links = site?.nav.length ?? 0;
  for (const b of page.blocks) {
    if (b.type === 'categories') links += ctx.categoryCount;
    if (b.type === 'areas') links += ctx.cityCount;
    if (b.type === 'featured' || b.type === 'packages') links += Math.min(Number(b.props.limit ?? 4), 8);
    if (b.type === 'cta' || b.type === 'hero') links += 1;
    if (b.type === 'richtext') links += (String(b.props.markdown ?? '').match(/\]\(\//g) ?? []).length;
  }
  const city = page.kind === 'city' ? page.local?.city : page.kind === 'page' && page.slug === '' ? t.city : undefined;
  const keyword = page.kind === 'city' || (page.kind === 'page' && page.slug === '') ? 'bounce house rental' : undefined;
  const r = scorePage({ title, description, h1, bodyText: pageText(page), hasSchema: true, images, internalLinks: links, keyword, city });
  return { ...r, title, description, keyword, city };
}

export const scoreTone = (n: number) => (n >= 85 ? 'bg-green-50 text-green-800' : n >= 65 ? 'bg-sun/30 text-[#7A5200]' : 'bg-red-50 text-red-800');
