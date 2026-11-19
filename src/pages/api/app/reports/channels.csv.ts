import type { APIRoute } from 'astro';
import { guard, csvResponse, rangeDays } from './_shared';
import { revenueByChannel, toCsv, dollars } from '../../../../lib/ops/reports';
import { addDays } from '../../../../lib/time';

export const GET: APIRoute = async (ctx) => {
  const g = guard(ctx); if ('error' in g) return g.error;
  const days = rangeDays(ctx.url.searchParams.get('range'));
  const rows = await revenueByChannel(g.t, addDays(g.today, -days));
  return csvResponse(`revenue-by-channel-${g.today}.csv`, toCsv(['channel', 'bookings', 'revenue'], rows.map((r) => [r.channel, r.n, dollars(r.revenue)])));
};
