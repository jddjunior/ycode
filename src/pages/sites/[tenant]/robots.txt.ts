/** Per-tenant robots.txt. Preview URLs (/sites/{slug}) are never indexed. */
import type { APIRoute } from 'astro';
import { siteOrigin } from '../../../lib/tenant';

export const GET: APIRoute = async ({ locals, params }) => {
  const s = locals.site;
  if (!s || s.tenant.slug !== params.tenant) return new Response('Not found', { status: 404 });
  const origin = await siteOrigin(s.tenant);
  const body = s.base
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nDisallow: /book\nDisallow: /booking/\nDisallow: /api/\nDisallow: /*?*date=\n\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
