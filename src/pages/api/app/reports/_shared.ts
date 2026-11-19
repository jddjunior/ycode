/** Shared guard + response helper for report CSV endpoints. */
import type { APIContext } from 'astro';
import { localDay } from '../../../../lib/time';

export function guard(ctx: APIContext) {
  const s = ctx.locals.session;
  if (!s?.tenant) return { error: new Response('unauthorized', { status: 401 }) } as const;
  if (s.role !== 'owner' && s.role !== 'manager') return { error: new Response('forbidden', { status: 403 }) } as const;
  return { t: s.tenant, today: localDay(new Date(), s.tenant.timezone) } as const;
}

export function csvResponse(name: string, body: string) {
  return new Response('﻿' + body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' },
  });
}

export const rangeDays = (v: string | null) => (v === '90' ? 90 : v === 'all' || v === '3650' ? 3650 : 365);
