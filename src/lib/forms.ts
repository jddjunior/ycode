/**
 * Form helpers for Astro pages that handle their own POSTs
 * (progressive enhancement: everything works without JS).
 * Astro's security.checkOrigin blocks cross-site form POSTs (CSRF).
 */
import type { AstroGlobal, AstroCookies } from 'astro';
import { z } from 'zod';

export async function formData(Astro: AstroGlobal): Promise<FormData | null> {
  if (Astro.request.method !== 'POST') return null;
  const ct = Astro.request.headers.get('content-type') ?? '';
  if (!ct.includes('form')) return null;
  return Astro.request.formData();
}

export const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? '').trim().slice(0, max);
export const bool = (f: FormData, k: string) => ['on', 'true', '1', 'yes'].includes(String(f.get(k) ?? ''));
export const int = (f: FormData, k: string, dflt = 0) => { const n = Number.parseInt(String(f.get(k) ?? ''), 10); return Number.isFinite(n) ? n : dflt; };
export const cents = (f: FormData, k: string) => { const n = Number.parseFloat(String(f.get(k) ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
export const list = (f: FormData, k: string) => String(f.get(k) ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): { ok: true; data: z.infer<T> } | { ok: false; errors: Record<string, string> } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) errors[i.path.join('.') || '_'] ??= i.message;
  return { ok: false, errors };
}

/** One-shot flash message carried across a POST→redirect→GET. */
export function flash(cookies: AstroCookies, msg: string, kind: 'ok' | 'error' = 'ok') {
  cookies.set('bos_flash', JSON.stringify({ msg: msg.slice(0, 300), kind }), { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 30 });
}
export function readFlash(cookies: AstroCookies): { msg: string; kind: 'ok' | 'error' } | null {
  const v = cookies.get('bos_flash')?.value;
  if (!v) return null;
  cookies.delete('bos_flash', { path: '/' });
  try { return JSON.parse(v); } catch { return null; }
}

export const isSecure = (url: URL) => url.protocol === 'https:';

/** Only allow same-site relative redirects. */
export const safeNext = (n: string | null | undefined, dflt = '/app') => (n && /^\/(?!\/)[\w\-./?=&%]*$/.test(n) ? n : dflt);

export const clientIp = (req: Request, fallback = '0.0.0.0') =>
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || fallback;
