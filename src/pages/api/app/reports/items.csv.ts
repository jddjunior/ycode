import type { APIRoute } from 'astro';
import { guard, csvResponse } from './_shared';
import { itemPerformance, toCsv, dollars } from '../../../../lib/ops/reports';

export const GET: APIRoute = async (ctx) => {
  const g = guard(ctx); if (g instanceof Response) return g;
  const rows = await itemPerformance(g.t, 90);
  return csvResponse(`item-utilization-${g.today}.csv`, toCsv(['item', 'kind', 'units', 'unit_days_booked_90d', 'utilization_pct_90d', 'bookings', 'lifetime_revenue', 'maintenance_cost', 'purchase_cost', 'roi_pct'],
    rows.map((r) => [r.name, r.kind, r.quantity, r.unitDays, r.util, r.bookings, dollars(r.revenue), dollars(r.maintenance), r.purchase == null ? '' : dollars(r.purchase), r.roi])));
};
