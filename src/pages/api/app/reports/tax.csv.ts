import type { APIRoute } from 'astro';
import { guard, csvResponse } from './_shared';
import { salesTax, toCsv, dollars } from '../../../../lib/ops/reports';

export const GET: APIRoute = async (ctx) => {
  const g = guard(ctx); if ('error' in g) return g.error;
  const q = ctx.url.searchParams;
  const year = Math.min(2100, Math.max(2000, Number(q.get('year')) || Number(g.today.slice(0, 4))));
  const period = q.get('period') === 'quarter' ? 'quarter' : 'month';
  const rows = await salesTax(g.t, year, period);
  const rate = ((g.t.settings?.taxRateBps ?? 0) / 100).toFixed(3);
  return csvResponse(`sales-tax-${year}-${period}.csv`, toCsv(['period', 'bookings', 'gross_sales', 'taxable_sales', 'non_taxable_delivery', 'tax_rate_pct', 'tax_collected'],
    rows.map((r) => [r.period, r.n, dollars(r.gross), dollars(r.taxable), dollars(r.delivery), rate, dollars(r.tax)])));
};
