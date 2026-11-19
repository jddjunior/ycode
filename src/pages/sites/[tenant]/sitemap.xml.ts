/** Per-tenant sitemap with absolute URLs from siteOrigin. */
import type { APIRoute } from 'astro';
import { loadSiteCtx, loadCmsPages } from '../../../lib/site/data';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const GET: APIRoute = async ({ locals, params }) => {
  const ctx = await loadSiteCtx(locals, params.tenant);
  if (!ctx) return new Response('Not found', { status: 404 });
  const pages = await loadCmsPages(ctx.tenant.id);
  const urls: { loc: string; lastmod?: Date; pri: string }[] = [];
  const add = (p: string, pri: string, lastmod?: Date) => urls.push({ loc: ctx.abs(p), pri, lastmod });
  add('/', '1.0', ctx.site.updatedAt);
  add('/rentals', '0.9');
  for (const c of ctx.categories) if (ctx.items.some((i) => i.categoryId === c.id && i.kind !== 'package')) add(`/rentals/${c.slug}`, '0.8');
  if (ctx.items.some((i) => i.kind === 'package')) add('/rentals/packages', '0.7');
  for (const i of ctx.items) add(ctx.itemPath(i), i.kind === 'addon' ? '0.5' : '0.7', i.updatedAt);
  if (ctx.cities.length) add('/areas', '0.7');
  for (const p of pages) {
    if (p.kind === 'city') add(`/areas/${p.slug}`, '0.8', p.updatedAt);
    else if (p.slug) add(`/${p.slug}`, p.kind === 'post' ? '0.6' : '0.5', p.updatedAt);
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}<priority>${u.pri}</priority></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
