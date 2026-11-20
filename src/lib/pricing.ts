/**
 * Quote calculator (pure). All amounts in integer cents. Rounding is
 * half-up at each line so the itemised receipt always sums exactly.
 */
import type { TenantSettings, PlanId } from '../db/schema';
import { PLANS } from './plans';

export interface PriceItem {
  id: string; name: string; priceCents: number; baseHours: number;
  extraHourCents: number; overnightCents: number | null;
}

export interface QuoteInput {
  lines: { itemId: string; qty: number }[];
  items: PriceItem[];
  hours: number;
  overnight?: boolean;
  deliveryCents: number;
  surfaceCents?: number;
  damageWaiver?: boolean;
  coupon?: { percentOff?: number | null; amountOffCents?: number | null } | null;
  settings: TenantSettings;
  plan: PlanId;
}

export interface QuoteLine { itemId: string; name: string; qty: number; unitCents: number; totalCents: number }

export interface Quote {
  lines: QuoteLine[];
  subtotalCents: number;
  deliveryCents: number;
  surfaceCents: number;
  damageWaiverCents: number;
  discountCents: number;
  taxCents: number;
  customerFeeCents: number;
  totalCents: number;
  depositCents: number;
  /** Branch Avenue's application fee on the payment (not shown to customer unless passed through). */
  platformFeeCents: number;
  /** What the operator nets after the platform fee (before Stripe processing). */
  operatorNetCents: number;
}

const pct = (amount: number, bps: number) => Math.round((amount * bps) / 10_000);

export function unitPrice(it: PriceItem, hours: number, overnight = false): number {
  if (overnight && it.overnightCents != null) return it.overnightCents;
  const extra = Math.max(0, Math.ceil(hours - it.baseHours));
  return it.priceCents + extra * it.extraHourCents;
}

export function quote(q: QuoteInput): Quote {
  const byId = new Map(q.items.map((i) => [i.id, i]));
  const lines: QuoteLine[] = [];
  for (const l of q.lines) {
    const it = byId.get(l.itemId);
    if (!it || l.qty <= 0) continue;
    const unit = unitPrice(it, q.hours, q.overnight);
    lines.push({ itemId: it.id, name: it.name, qty: l.qty, unitCents: unit, totalCents: unit * l.qty });
  }
  const subtotal = lines.reduce((s, l) => s + l.totalCents, 0);
  const s = q.settings;

  let discount = 0;
  if (q.coupon?.percentOff) discount = pct(subtotal, q.coupon.percentOff * 100);
  else if (q.coupon?.amountOffCents) discount = Math.min(subtotal, q.coupon.amountOffCents);

  const surface = q.surfaceCents ?? 0;
  const waiver = q.damageWaiver && s.damageWaiverBps ? pct(subtotal - discount, s.damageWaiverBps) : 0;
  const taxable = subtotal - discount + waiver + surface;   // delivery typically non-taxable
  const tax = pct(taxable, s.taxRateBps ?? 0);
  const preFee = subtotal - discount + q.deliveryCents + surface + waiver + tax;

  const plan = PLANS[q.plan] ?? PLANS.starter;
  const platformFee = pct(preFee, plan.platformFeeBps);
  const customerFee = s.passPlatformFeeToCustomer ? platformFee : 0;
  const total = preFee + customerFee;

  let deposit: number;
  const dt = s.depositType ?? 'percent';
  if (dt === 'full') deposit = total;
  else if (dt === 'fixed') deposit = Math.min(total, s.depositValue ?? 5000);
  else deposit = pct(total, (s.depositValue ?? 25) * 100);
  // The platform fee is always collected on the first charge, so deposit ≥ fee.
  deposit = Math.max(deposit, Math.min(total, platformFee + customerFee));

  return {
    lines,
    subtotalCents: subtotal,
    deliveryCents: q.deliveryCents,
    surfaceCents: surface,
    damageWaiverCents: waiver,
    discountCents: discount,
    taxCents: tax,
    customerFeeCents: customerFee,
    totalCents: total,
    depositCents: deposit,
    platformFeeCents: platformFee,
    operatorNetCents: total - platformFee,
  };
}

export const money = (cents: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
