/**
 * Operator-app request context + small shared helpers for the ops pages
 * (Game Plan, bookings, inventory, CRM, deliveries, crew, reports, settings).
 * Every query in those pages is scoped by `ctx.t.id`.
 */
import type { AstroGlobal } from 'astro';
import type { TenantSettings } from '../../db/schema';
import { localDay, formatLocal, addDays, zonedToUtc, isValidDay } from '../time';

export function opsCtx(Astro: AstroGlobal) {
  const s = Astro.locals.session!;
  const t = s.tenant!;
  const role = s.role ?? 'crew';
  return {
    s, t, role, tz: t.timezone,
    isOwner: role === 'owner',
    canManage: role === 'owner' || role === 'manager',
    settings: (t.settings ?? {}) as OpsSettings,
    today: localDay(new Date(), t.timezone),
  };
}

/** Extra keys kept in tenants.settings (jsonb) that the shared type doesn't list. */
export type OpsSettings = TenantSettings & { monthlyGoalCents?: number };

export const centsToInput = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''));

export function dayBounds(day: string, tz: string) {
  return { from: zonedToUtc(day, 0, 0, tz), to: zonedToUtc(addDays(day, 1), 0, 0, tz) };
}

/** [from, to) for the calendar month containing `day`, shifted by `offset` months. */
export function monthBounds(day: string, tz: string, offset = 0) {
  const [y, m] = day.split('-').map(Number);
  const d0 = new Date(Date.UTC(y, m - 1 + offset, 1));
  const d1 = new Date(Date.UTC(y, m + offset, 1));
  const a = d0.toISOString().slice(0, 10), b = d1.toISOString().slice(0, 10);
  return { from: zonedToUtc(a, 0, 0, tz), to: zonedToUtc(b, 0, 0, tz), firstDay: a, nextFirstDay: b,
    label: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d0) };
}

export const pickDay = (v: string | null | undefined, dflt: string) => (isValidDay(v) ? v : dflt);

export function dayTitle(day: string, today: string) {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));
}
export const shortDay = (day: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));

export const time = (d: Date, tz: string) => formatLocal(d, tz, { hour: 'numeric', minute: '2-digit' });
export const dateTime = (d: Date, tz: string) => formatLocal(d, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const dateOnly = (d: Date, tz: string) => formatLocal(d, tz, { month: 'short', day: 'numeric', year: 'numeric' });

export const STATUS: Record<string, { label: string; cls: string }> = {
  hold: { label: 'Hold', cls: 'bg-amber-100 text-amber-900' },
  quote: { label: 'Quote', cls: 'bg-sky-100 text-sky-800' },
  pending: { label: 'Pending', cls: 'bg-orange-100 text-orange-800' },
  confirmed: { label: 'Confirmed', cls: 'bg-brand-soft text-brand' },
  completed: { label: 'Completed', cls: 'bg-green-100 text-green-800' },
  canceled: { label: 'Canceled', cls: 'bg-gray-100 text-gray-600' },
};

export const STAGES = ['new', 'contacted', 'quoted', 'won', 'lost'] as const;
export const STAGE_META: Record<string, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-sky-100 text-sky-800' },
  contacted: { label: 'Contacted', cls: 'bg-orange-100 text-orange-800' },
  quoted: { label: 'Quoted', cls: 'bg-brand-soft text-brand' },
  won: { label: 'Won', cls: 'bg-green-100 text-green-800' },
  lost: { label: 'Lost', cls: 'bg-gray-100 text-gray-600' },
};

export const CHANNELS: Record<string, string> = {
  organic: 'Organic search', paid_search: 'Paid search', paid_social: 'Paid social', social: 'Social', email: 'Email',
  sms: 'SMS', referral: 'Referral', marketplace: 'Marketplace', direct: 'Direct', partner: 'Partner', phone: 'Phone / manual',
};

export const CUSTOMER_TYPES = ['residential', 'school', 'church', 'corporate', 'municipal', 'nonprofit'] as const;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

/** Percent change label, e.g. "+12%" / "−4%" / "new". */
export function delta(cur: number, prev: number) {
  if (!prev) return cur ? { label: 'new', up: true } : { label: '—', up: true };
  const p = Math.round(((cur - prev) / prev) * 100);
  return { label: `${p >= 0 ? '+' : '−'}${Math.abs(p)}%`, up: p >= 0 };
}

export const mapsLink = (b: { lat: number | null; lng: number | null; address: string; city: string; state: string; zip: string }) => {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', b.lat != null && b.lng != null ? `${b.lat},${b.lng}` : [b.address, b.city, b.state, b.zip].filter(Boolean).join(', '));
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
};

export const fullAddress = (b: { address: string; city: string; state: string; zip: string }) =>
  [b.address, [b.city, b.state].filter(Boolean).join(', '), b.zip].filter(Boolean).join(' ').trim();

export { localDay, addDays, isValidDay };
