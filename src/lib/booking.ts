/**
 * Booking service: DB-backed availability, quotes, holds and confirmation.
 * Overbooking is prevented by re-checking availability inside a transaction
 * that takes a per-tenant advisory lock before inserting the hold.
 */
import { and, eq, gt, inArray, lt, or, sql, isNull, desc } from 'drizzle-orm';
import { getDb, schema, type DB } from '../db/client';
import type { Tenant } from './auth';
import { checkCart, freeUnits, explode, type InvItem, type Reservation, type OutOfService } from './availability';
import { quote, type Quote } from './pricing';
import { matchZone } from './geo';
import { zonedToUtc, localDay } from './time';
import { token, sha256 } from './util';

export const ACTIVE_STATUSES = ['hold', 'pending', 'confirmed'] as const;

export interface EventWindow { day: string; startHour: number; endHour: number; overnight?: boolean }

export function windowFor(t: Tenant, w: EventWindow) {
  const startsAt = zonedToUtc(w.day, w.startHour, 0, t.timezone);
  const endDay = w.overnight || w.endHour <= w.startHour ? addOne(w.day) : w.day;
  const endsAt = zonedToUtc(endDay, w.overnight ? 10 : w.endHour, 0, t.timezone);
  return { startsAt, endsAt, hours: (endsAt.getTime() - startsAt.getTime()) / 3_600_000 };
}
const addOne = (d: string) => new Date(Date.parse(d + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10);

export async function loadInventory(db: DB, tenantId: string) {
  return db.select().from(schema.items).where(eq(schema.items.tenantId, tenantId)).orderBy(schema.items.sort, schema.items.name);
}

/** Active reservations overlapping [from, to) (with a generous buffer). */
async function loadReservations(db: DB, tenantId: string, from: Date, to: Date, excludeBookingId?: string) {
  const pad = 24 * 3_600_000;
  const rows = await db.select({
    itemId: schema.bookingLines.itemId, qty: schema.bookingLines.qty,
    startsAt: schema.bookings.startsAt, endsAt: schema.bookings.endsAt, bookingId: schema.bookings.id,
  }).from(schema.bookingLines)
    .innerJoin(schema.bookings, eq(schema.bookings.id, schema.bookingLines.bookingId))
    .where(and(
      eq(schema.bookings.tenantId, tenantId),
      inArray(schema.bookings.status, [...ACTIVE_STATUSES]),
      lt(schema.bookings.startsAt, new Date(to.getTime() + pad)),
      gt(schema.bookings.endsAt, new Date(from.getTime() - pad)),
      or(sql`${schema.bookings.status} <> 'hold'`, gt(schema.bookings.holdExpiresAt, sql`now()`)),
    ));
  return rows.filter((r) => r.bookingId !== excludeBookingId);
}

async function loadOutOfService(db: DB, tenantId: string): Promise<OutOfService[]> {
  const rows = await db.select().from(schema.maintenanceLogs).where(and(
    eq(schema.maintenanceLogs.tenantId, tenantId),
    or(isNull(schema.maintenanceLogs.outOfServiceUntil), gt(schema.maintenanceLogs.outOfServiceUntil, sql`now()`)),
    inArray(schema.maintenanceLogs.kind, ['repair', 'retired']),
  ));
  return rows.map((r) => ({ itemId: r.itemId, units: r.unitsAffected, from: r.createdAt, until: r.kind === 'retired' ? null : r.outOfServiceUntil }));
}

function toInv(rows: (typeof schema.items.$inferSelect)[]): InvItem[] {
  return rows.map((r) => ({ id: r.id, quantity: r.quantity, setupMinutes: r.setupMinutes, teardownMinutes: r.teardownMinutes, kind: r.kind, bundle: r.bundle, active: r.active }));
}

function toRes(rows: { itemId: string; qty: number; startsAt: Date; endsAt: Date }[], inv: InvItem[]): Reservation[] {
  // Reservation lines may reference packages → explode to components.
  const byId = new Map(inv.map((i) => [i.id, i]));
  return rows.flatMap((r) => explode([{ itemId: r.itemId, qty: r.qty }], byId).map((x) => ({ ...x, startsAt: r.startsAt, endsAt: r.endsAt })));
}

export async function isBlackout(db: DB, tenantId: string, day: string) {
  const [b] = await db.select().from(schema.blackouts).where(and(eq(schema.blackouts.tenantId, tenantId), eq(schema.blackouts.day, day))).limit(1);
  return !!b;
}

export async function eventsOnDay(db: DB, t: Tenant, day: string) {
  const from = zonedToUtc(day, 0, 0, t.timezone), to = zonedToUtc(addOne(day), 0, 0, t.timezone);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.bookings).where(and(
    eq(schema.bookings.tenantId, t.id), inArray(schema.bookings.status, [...ACTIVE_STATUSES]),
    gt(schema.bookings.startsAt, from), lt(schema.bookings.startsAt, to),
    or(sql`${schema.bookings.status} <> 'hold'`, gt(schema.bookings.holdExpiresAt, sql`now()`)),
  ));
  return r?.n ?? 0;
}

export interface AvailabilityResult {
  ok: boolean;
  reason?: 'blackout' | 'lead_time' | 'too_far' | 'day_full' | 'invalid';
  window: { startsAt: Date; endsAt: Date; hours: number };
  free: Record<string, number>;
}

export async function availability(t: Tenant, w: EventWindow, opts: { excludeBookingId?: string; skipRules?: boolean } = {}): Promise<AvailabilityResult> {
  const db = await getDb();
  const win = windowFor(t, w);
  const s = t.settings ?? {};
  const base = { window: win, free: {} as Record<string, number> };
  if (!opts.skipRules) {
    if (await isBlackout(db, t.id, w.day)) return { ok: false, reason: 'blackout', ...base };
    if (win.startsAt.getTime() < Date.now() + (s.leadTimeHours ?? 24) * 3_600_000) return { ok: false, reason: 'lead_time', ...base };
    if (win.startsAt.getTime() > Date.now() + (s.maxDaysAhead ?? 365) * 86_400_000) return { ok: false, reason: 'too_far', ...base };
    if (s.maxEventsPerDay && (await eventsOnDay(db, t, w.day)) >= s.maxEventsPerDay) return { ok: false, reason: 'day_full', ...base };
  }
  const rows = await loadInventory(db, t.id);
  const inv = toInv(rows);
  const res = toRes(await loadReservations(db, t.id, win.startsAt, win.endsAt, opts.excludeBookingId), inv);
  const free = freeUnits(inv, res, await loadOutOfService(db, t.id), win);
  return { ok: true, ...base, free: Object.fromEntries(free) };
}

export interface CartRequest {
  window: EventWindow;
  lines: { itemId: string; qty: number }[];
  zip: string;
  surface?: string;
  damageWaiver?: boolean;
  couponCode?: string | null;
}

export interface PricedCart {
  quote: Quote;
  zone: { id: string; name: string } | null;
  deliverable: boolean;
  belowMinimum: boolean;
  conflicts: { itemId: string; requested: number; free: number }[];
  coupon: typeof schema.coupons.$inferSelect | null;
  window: { startsAt: Date; endsAt: Date; hours: number };
}

export async function priceCart(t: Tenant, req: CartRequest, opts: { excludeBookingId?: string; db?: DB } = {}): Promise<PricedCart> {
  const db = opts.db ?? await getDb();
  const s = t.settings ?? {};
  const win = windowFor(t, req.window);
  const rows = await loadInventory(db, t.id);
  const inv = toInv(rows);
  const res = toRes(await loadReservations(db, t.id, win.startsAt, win.endsAt, opts.excludeBookingId), inv);
  const conflicts = checkCart(inv, res, await loadOutOfService(db, t.id), win, req.lines);

  const zones = await db.select().from(schema.deliveryZones).where(eq(schema.deliveryZones.tenantId, t.id));
  const zone = matchZone(zones, req.zip, null, t.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : null);

  let coupon: typeof schema.coupons.$inferSelect | null = null;
  if (req.couponCode) {
    const [c] = await db.select().from(schema.coupons).where(and(
      eq(schema.coupons.tenantId, t.id), sql`upper(${schema.coupons.code}) = upper(${req.couponCode})`, eq(schema.coupons.active, true))).limit(1);
    if (c && (!c.expiresAt || c.expiresAt > new Date()) && (c.maxUses == null || c.uses < c.maxUses)) coupon = c;
  }
  const surfaceFee = (s.surfaces ?? []).find((x) => x.key === req.surface)?.feeCents ?? 0;
  const q = quote({
    lines: req.lines, items: rows, hours: win.hours, overnight: req.window.overnight,
    deliveryCents: zone?.feeCents ?? 0, surfaceCents: surfaceFee, damageWaiver: req.damageWaiver,
    coupon, settings: s, plan: t.plan,
  });
  const minOrder = Math.max(zone?.minOrderCents ?? 0, s.minOrderCents ?? 0);
  return {
    quote: q, zone: zone ? { id: zone.id, name: zone.name } : null, deliverable: !!zone || zones.length === 0,
    belowMinimum: q.subtotalCents < minOrder, conflicts, coupon, window: win,
  };
}

export interface CustomerInput {
  email: string; name: string; phone: string;
  celebrantName?: string | null; celebrantBirthday?: string | null;
  marketingOptIn?: boolean; smsOptIn?: boolean; type?: typeof schema.customers.$inferInsert['type']; organization?: string | null;
}

export async function upsertCustomer(db: DB, tenantId: string, c: CustomerInput, source = 'website') {
  const [existing] = await db.select().from(schema.customers)
    .where(and(eq(schema.customers.tenantId, tenantId), sql`lower(${schema.customers.email}) = lower(${c.email})`)).limit(1);
  if (existing) {
    const [u] = await db.update(schema.customers).set({
      name: c.name || existing.name, phone: c.phone || existing.phone,
      celebrantName: c.celebrantName ?? existing.celebrantName, celebrantBirthday: c.celebrantBirthday ?? existing.celebrantBirthday,
      marketingOptIn: c.marketingOptIn ?? existing.marketingOptIn, smsOptIn: c.smsOptIn ?? existing.smsOptIn,
    }).where(eq(schema.customers.id, existing.id)).returning();
    return u;
  }
  const [n] = await db.insert(schema.customers).values({
    tenantId, email: c.email.trim(), name: c.name, phone: c.phone, celebrantName: c.celebrantName ?? null,
    celebrantBirthday: c.celebrantBirthday ?? null, marketingOptIn: !!c.marketingOptIn, smsOptIn: !!c.smsOptIn,
    type: c.type ?? 'residential', organization: c.organization ?? null, source,
  }).returning();
  return n;
}

export class BookingError extends Error {
  constructor(public code: 'unavailable' | 'undeliverable' | 'minimum' | 'empty' | 'rules', message: string, public detail?: unknown) { super(message); }
}

export interface CreateBookingInput extends CartRequest {
  customer: CustomerInput;
  address: string; city: string; state: string;
  eventType?: string; notes?: string;
  status?: 'hold' | 'quote' | 'confirmed' | 'pending';
  agreement?: { name: string; ip: string; text: string } | null;
  attribution?: typeof schema.bookings.$inferInsert['attribution'];
  leadId?: string | null;
  source?: string;
  skipRules?: boolean;
}

/** Create a booking (default: a short-lived hold awaiting deposit payment). */
export async function createBooking(t: Tenant, input: CreateBookingInput) {
  const db = await getDb();
  if (!input.lines.length) throw new BookingError('empty', 'Your cart is empty.');
  if (!input.skipRules) {
    const av = await availability(t, input.window);
    if (!av.ok) throw new BookingError('rules', ruleMessage(av.reason), av.reason);
  }
  return db.transaction(async (tx) => {
    // Serialise bookings per tenant so two shoppers can't grab the last unit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'book:' + t.id}))`);
    const priced = await priceCart(t, input, { db: tx as unknown as DB });
    if (priced.conflicts.length) throw new BookingError('unavailable', 'Some items were just booked for that time.', priced.conflicts);
    if (!priced.deliverable) throw new BookingError('undeliverable', 'Sorry — we don’t deliver to that ZIP code yet.');
    if (priced.belowMinimum && !input.skipRules) throw new BookingError('minimum', 'Your order is below the delivery minimum for that area.');

    const customer = await upsertCustomer(tx as unknown as DB, t.id, input.customer, input.source);
    const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${schema.bookings.number}), 1000) + 1` })
      .from(schema.bookings).where(eq(schema.bookings.tenantId, t.id)));
    const q = priced.quote;
    const status = input.status ?? 'hold';
    const holdMin = t.settings?.holdMinutes ?? 30;
    const [b] = await tx.insert(schema.bookings).values({
      tenantId: t.id, number: next, customerId: customer.id, status,
      startsAt: priced.window.startsAt, endsAt: priced.window.endsAt,
      holdExpiresAt: status === 'hold' ? new Date(Date.now() + holdMin * 60_000) : null,
      address: input.address, city: input.city, state: input.state, zip: input.zip, surface: input.surface ?? 'grass',
      eventType: input.eventType ?? 'birthday', notes: input.notes ?? '',
      subtotalCents: q.subtotalCents, deliveryCents: q.deliveryCents, surfaceCents: q.surfaceCents,
      damageWaiverCents: q.damageWaiverCents, discountCents: q.discountCents, taxCents: q.taxCents,
      platformFeeCents: q.platformFeeCents, customerFeeCents: q.customerFeeCents, totalCents: q.totalCents,
      depositCents: q.depositCents, couponCode: priced.coupon?.code ?? null,
      agreementSignedName: input.agreement?.name ?? null, agreementSignedAt: input.agreement ? new Date() : null,
      agreementSignedIp: input.agreement?.ip ?? null, agreementHash: input.agreement ? sha256(input.agreement.text) : null,
      attribution: input.attribution ?? {}, leadId: input.leadId ?? null, publicToken: token(18),
    }).returning();
    if (q.lines.length) {
      await tx.insert(schema.bookingLines).values(q.lines.map((l) => ({
        tenantId: t.id, bookingId: b.id, itemId: l.itemId, name: l.name, qty: l.qty, unitCents: l.unitCents, totalCents: l.totalCents,
      })));
    }
    if (priced.coupon) await tx.update(schema.coupons).set({ uses: sql`${schema.coupons.uses} + 1` }).where(eq(schema.coupons.id, priced.coupon.id));
    return { booking: b, customer, quote: q };
  });
}

export function ruleMessage(r?: string) {
  switch (r) {
    case 'blackout': return 'We’re closed that day — try another date.';
    case 'lead_time': return 'That date is too soon to book online — call or text us and we’ll try to make it happen!';
    case 'too_far': return 'That date is too far out to book online yet.';
    case 'day_full': return 'We’re fully booked that day. Try a nearby date or join the waitlist.';
    default: return 'That date isn’t available.';
  }
}

/** Mark a booking paid/confirmed (idempotent). Returns the updated row. */
export async function recordPayment(tenantId: string, bookingId: string, p: { provider: 'stripe' | 'demo' | 'cash' | 'check' | 'other'; ref: string | null; amountCents: number; applicationFeeCents: number }) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    if (p.ref) {
      const [dupe] = await tx.select().from(schema.payments).where(eq(schema.payments.providerRef, p.ref)).limit(1);
      if (dupe) { const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId)); return { booking: b, duplicate: true }; }
    }
    await tx.insert(schema.payments).values({ tenantId, bookingId, provider: p.provider, providerRef: p.ref, amountCents: p.amountCents, applicationFeeCents: p.applicationFeeCents, status: 'succeeded' });
    const [b] = await tx.update(schema.bookings).set({
      paidCents: sql`${schema.bookings.paidCents} + ${p.amountCents}`,
      status: sql`case when ${schema.bookings.status} in ('hold','pending','quote') then 'confirmed' else ${schema.bookings.status} end`,
      holdExpiresAt: null, updatedAt: new Date(),
    }).where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, tenantId))).returning();
    if (b?.customerId) {
      await tx.update(schema.customers).set({ lifetimeValueCents: sql`${schema.customers.lifetimeValueCents} + ${p.amountCents}` }).where(eq(schema.customers.id, b.customerId));
    }
    return { booking: b, duplicate: false };
  });
}

export async function bookingWithLines(tenantId: string, bookingId: string) {
  const db = await getDb();
  const [b] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, tenantId))).limit(1);
  if (!b) return null;
  const lines = await db.select().from(schema.bookingLines).where(eq(schema.bookingLines.bookingId, b.id));
  const [customer] = b.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, b.customerId)) : [null];
  return { booking: b, lines, customer };
}

export async function recentBookings(tenantId: string, limit = 50) {
  const db = await getDb();
  return db.select({ b: schema.bookings, c: schema.customers }).from(schema.bookings)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.bookings.customerId))
    .where(and(eq(schema.bookings.tenantId, tenantId), sql`${schema.bookings.status} <> 'hold' or ${schema.bookings.holdExpiresAt} > now()`))
    .orderBy(desc(schema.bookings.startsAt)).limit(limit);
}

export { localDay };
