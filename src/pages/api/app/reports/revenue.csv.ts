import type { APIRoute } from 'astro';
import { guard, csvResponse } from './_shared';
import { lastMonths, revenueByMonth, toCsv, dollars } from '../../../../lib/ops/reports';

export const GET: APIRoute = async (ctx) => {
  const g = guard(ctx); if ('error' in g) return g.error;
  const rows = await revenueByMonth(g.t, lastMonths(g.t, 24));
  return csvResponse(`revenue-by-month-${g.today}.csv`, toCsv(['month', 'bookings', 'booked_revenue', 'collected', 'platform_fees'], rows.map((r) => [r.k, r.n, dollars(r.revenue), dollars(r.collected), dollars(r.fees)])));
};
