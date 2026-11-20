import type { APIRoute } from 'astro';
import { guard, csvResponse, rangeDays } from './_shared';
import { revenueByCategory, toCsv, dollars } from '../../../../lib/ops/reports';
import { addDays } from '../../../../lib/time';

export const GET: APIRoute = async (ctx) => {
  const g = guard(ctx); if (g instanceof Response) return g;
  const days = rangeDays(ctx.url.searchParams.get('range'));
  const rows = await revenueByCategory(g.t, addDays(g.today, -days));
  return csvResponse(`revenue-by-category-${g.today}.csv`, toCsv(['category', 'units_rented', 'revenue'], rows.map((r) => [r.name, r.units, dollars(r.revenue)])));
};
