/** Helpers for the public storefront JSON API (/api/public/{tenant}/…). */
import type { APIContext } from 'astro';
import { z } from 'zod';
import type { Tenant } from '../auth';
import { tenantBySlug } from '../tenant';
import { rateLimit } from '../ratelimit';
import { clientIp } from '../forms';
import { BookingError, ruleMessage } from '../booking';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

export const apiError = (status: number, code: string, message: string, detail?: unknown) => json({ ok: false, code, message, detail }, status);

/** Resolve the tenant from the route param and apply a per-IP rate limit. */
export async function publicTenant(ctx: APIContext, bucket: string, capacity = 60, perMin = 60): Promise<{ t: Tenant; ip: string } | Response> {
  const slug = String(ctx.params.tenant ?? '');
  const t = await tenantBySlug(slug);
  if (!t || t.status === 'canceled') return apiError(404, 'not_found', 'This business could not be found.');
  const ip = clientIp(ctx.request, ctx.clientAddress ?? '0.0.0.0');
  if (!rateLimit(`pub:${bucket}:${t.id}:${ip}`, capacity, perMin)) return apiError(429, 'rate_limited', 'Too many requests — please wait a moment and try again.');
  return { t, ip };
}

export async function readJson(req: Request): Promise<unknown> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const text = await req.text();
    if (text.length > 64_000) throw new Error('too_large');
    return text ? JSON.parse(text) : {};
  }
  if (ct.includes('form')) {
    const f = await req.formData();
    return Object.fromEntries([...f.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  }
  return {};
}

export function zodError(e: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const i of e.issues) fields[i.path.join('.') || '_'] ??= i.message;
  return apiError(422, 'invalid', 'Please check the highlighted fields.', fields);
}

export function bookingErrorResponse(e: unknown) {
  if (e instanceof BookingError) {
    const status = e.code === 'unavailable' ? 409 : 422;
    const message = e.code === 'rules' ? ruleMessage(String(e.detail ?? '')) : e.code === 'unavailable'
      ? 'Some items aren’t available in that quantity for your time (someone may have just booked them). We’ve marked them — adjust the cart or pick another time.'
      : e.message;
    return apiError(status, e.code, message, e.detail);
  }
  console.error('[storefront api]', e);
  return apiError(500, 'server', 'Something went wrong on our side. Please try again, or call/text us to book.');
}

/* ── shared zod pieces ── */
export const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date').refine((d) => !Number.isNaN(Date.parse(d + 'T00:00:00Z')), 'Pick a valid date');
export const zZip = z.string().trim().regex(/^\d{5}$/, 'Enter a 5-digit ZIP');
export const zHour = z.coerce.number().int().min(0).max(24);
export const zWindow = z.object({ day: zDay, startHour: zHour, endHour: zHour, overnight: z.boolean().optional() })
  .refine((w) => w.overnight || w.endHour > w.startHour, { message: 'End time must be after start time', path: ['endHour'] });
export const zLines = z.array(z.object({ itemId: z.uuid(), qty: z.coerce.number().int().min(1).max(20) })).max(30);

/** Keep only lines for this tenant's active items, merging duplicates. */
export function cleanLines(lines: { itemId: string; qty: number }[], activeIds: Set<string>) {
  const m = new Map<string, number>();
  for (const l of lines) if (activeIds.has(l.itemId)) m.set(l.itemId, Math.min(20, (m.get(l.itemId) ?? 0) + l.qty));
  return [...m].map(([itemId, qty]) => ({ itemId, qty }));
}
