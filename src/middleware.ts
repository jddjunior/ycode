import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth';
import { tenantByHost, tenantBySlug } from './lib/tenant';

const PASSTHROUGH = /^\/(api|_astro|_image|uploads|favicon|robots-platform|@|node_modules|src)\b/;

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { url, request } = ctx;
  const path = url.pathname;
  ctx.locals.session ??= null;

  // ── Tenant storefront on its own host → internal rewrite to /sites/{slug}/…
  if (!ctx.locals.site) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
    if (!PASSTHROUGH.test(path)) {
      const t = await tenantByHost(host);
      if (t) {
        const to = redirectFor(t, path);
        if (to) return ctx.redirect(to, 301);
        ctx.locals.site = { tenant: t, base: '' };
        const target = `/sites/${t.slug}${path === '/' ? '' : path}${url.search}`;
        return withHeaders(await ctx.rewrite(target), true);
      }
    }
    // ── Platform preview: /sites/{slug}/…
    const m = /^\/sites\/([a-z0-9-]+)(\/|$)/.exec(path);
    if (m) {
      const t = await tenantBySlug(m[1]);
      if (t) {
        const base = `/sites/${t.slug}`;
        const to = redirectFor(t, path.slice(base.length) || '/');
        if (to) return ctx.redirect(to.startsWith('/') ? base + to : to, 301);
        ctx.locals.site = { tenant: t, base };
      }
    }
  }

  // ── Sessions for the operator app, HQ, and authenticated APIs
  if (/^\/(app|hq|api\/app|api\/hq|login|signup|logout)\b/.test(path)) {
    ctx.locals.session = await readSession(ctx.cookies);
    const s = ctx.locals.session;
    if (path.startsWith('/app') && (!s || !s.tenant)) {
      return ctx.redirect(s ? '/signup?step=business' : `/login?next=${encodeURIComponent(path + url.search)}`);
    }
    if (path.startsWith('/hq') && !s?.user.isPlatformAdmin) return ctx.redirect('/login');
    if (path.startsWith('/api/app') && (!s || !s.tenant)) return json({ error: 'unauthorized' }, 401);
    if (path.startsWith('/api/hq') && !s?.user.isPlatformAdmin) return json({ error: 'unauthorized' }, 401);
    // Crew can only reach the crew app + their own logout.
    if (s?.role === 'crew' && path.startsWith('/app') && !path.startsWith('/app/crew')) return ctx.redirect('/app/crew');
  }

  const res = await next();
  return withHeaders(res, !!ctx.locals.site, path.startsWith('/app') || path.startsWith('/hq'));
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function withHeaders(res: Response, isSite: boolean, isPrivate = false): Response {
  const h = res.headers;
  try {
    h.set('x-content-type-options', 'nosniff');
    h.set('referrer-policy', 'strict-origin-when-cross-origin');
    h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(self), payment=(self "https://js.stripe.com")');
    h.set('cross-origin-opener-policy', 'same-origin-allow-popups');
    if (!h.has('x-frame-options')) h.set('x-frame-options', isSite ? 'SAMEORIGIN' : 'DENY');
    if (process.env.NODE_ENV === 'production') h.set('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
    if (isPrivate) h.set('cache-control', 'private, no-store');
  } catch { /* immutable headers (e.g. redirects from fetch) */ }
  return res;
}

/** Operator-managed 301s (settings.redirects) — preserves rankings after migrating from old software. */
function redirectFor(t: { settings: unknown }, path: string): string | null {
  const list = (t.settings as { redirects?: { from: string; to: string }[] })?.redirects;
  if (!Array.isArray(list) || !list.length) return null;
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p).toLowerCase();
  const hit = list.find((r) => typeof r?.from === 'string' && norm(r.from) === norm(path));
  if (!hit || typeof hit.to !== 'string') return null;
  // Only same-site paths or absolute http(s) URLs; never loop to itself.
  if (!/^(\/(?!\/)|https?:\/\/)/.test(hit.to) || norm(hit.to) === norm(path)) return null;
  return hit.to;
}
