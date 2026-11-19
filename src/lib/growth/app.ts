/** Small helpers shared by the growth pages of the operator app. */
import type { AstroGlobal } from 'astro';
import { formatLocal, zonedToUtc } from '../time';
import { flash } from '../forms';

export function ctx(Astro: AstroGlobal) {
  const s = Astro.locals.session!;
  const t = s.tenant!;
  return { s, t, tenantId: t.id, canEdit: s.role === 'owner' || s.role === 'manager' };
}

/** POST → flash → 303 redirect (PRG). */
export function done(Astro: AstroGlobal, msg: string, to?: string, kind: 'ok' | 'error' = 'ok') {
  flash(Astro.cookies, msg, kind);
  return Astro.redirect(to ?? Astro.url.pathname + Astro.url.search, 303);
}

export const fmtDay = (d: Date | null | undefined, tz: string) => (d ? formatLocal(d, tz, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
export const fmtDateTime = (d: Date | null | undefined, tz: string) => (d ? formatLocal(d, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

/** Parse an <input type="datetime-local"> value in the tenant's timezone. */
export function parseLocalDateTime(v: string, tz: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = zonedToUtc(m[1], Number(m[2]), Number(m[3]), tz);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Value for a datetime-local input, in the tenant's timezone. */
export function toLocalInput(d: Date, tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
