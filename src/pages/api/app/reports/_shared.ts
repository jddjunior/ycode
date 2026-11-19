/** Shared guard + response helper for report CSV endpoints. */
import type { APIContext } from 'astro';
import { localDay } from '../../../../lib/time';
import type { Tenant } from '../../../../lib/auth';

export function guard(ctx: APIContext): Response | { t: Tenant; today: string } {
  const s = ctx.locals.session;
  if (!s?.tenant) return new Response('unauthorized', { status: 401 });
  if (s.role !== 'owner' && s.role !== 'manager') return new Response('forbidden', { status: 403 });
  return { t: s.tenant, today: localDay(new Date(), s.tenant.timezone) };
}

export function csvResponse(name: string, body: string) {
  return new Response('﻿' + body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' },
  });
}

export const rangeDays = (v: string | null) => (v === '90' ? 90 : v === 'all' || v === '3650' ? 3650 : 365);
