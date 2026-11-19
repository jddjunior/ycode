/**
 * Availability engine (pure).
 *
 * An item with quantity Q is available for a window [s, e) when, for every
 * instant in the window *expanded by its setup/teardown buffers*, the number of
 * units reserved by overlapping active bookings + units out of service + the
 * requested qty ≤ Q. Packages reserve their component items.
 *
 * Implemented as a sweep line over interval endpoints: O(n log n) per item.
 */

export interface InvItem {
  id: string;
  quantity: number;
  setupMinutes: number;
  teardownMinutes: number;
  kind?: 'rental' | 'addon' | 'package';
  bundle?: { itemId: string; qty: number }[];
  active?: boolean;
}

export interface Reservation {
  itemId: string;
  qty: number;
  startsAt: Date;
  endsAt: Date;
}

export interface OutOfService { itemId: string; units: number; from: Date; until: Date | null }

export interface Window { startsAt: Date; endsAt: Date }

const MIN = 60_000;

/** Expand package lines into component reservations; rentals/add-ons pass through. */
export function explode(lines: { itemId: string; qty: number }[], byId: Map<string, InvItem>): { itemId: string; qty: number }[] {
  const out = new Map<string, number>();
  const add = (id: string, q: number, depth: number) => {
    const it = byId.get(id);
    if (it?.kind === 'package' && it.bundle?.length && depth < 3) {
      for (const c of it.bundle) add(c.itemId, c.qty * q, depth + 1);
      return;
    }
    out.set(id, (out.get(id) ?? 0) + q);
  };
  for (const l of lines) add(l.itemId, l.qty, 0);
  return [...out].map(([itemId, qty]) => ({ itemId, qty }));
}

/** Peak concurrent units in use for an item across [from, to). */
export function peakUsage(intervals: { s: number; e: number; q: number }[], from: number, to: number): number {
  const ev: [number, number][] = [];
  for (const iv of intervals) {
    const s = Math.max(iv.s, from), e = Math.min(iv.e, to);
    if (s < e) { ev.push([s, iv.q]); ev.push([e, -iv.q]); }
  }
  // ends before starts at the same timestamp → back-to-back windows don't collide
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, peak = 0;
  for (const [, d] of ev) { cur += d; if (cur > peak) peak = cur; }
  return peak;
}

/**
 * Units of each item still free for `win`. Reservations must already be
 * exploded to component items (see explode()).
 */
export function freeUnits(
  items: InvItem[],
  reservations: Reservation[],
  outOfService: OutOfService[],
  win: Window,
): Map<string, number> {
  const res = new Map<string, number>();
  const byItem = new Map<string, { s: number; e: number; q: number }[]>();
  const itemMap = new Map(items.map((i) => [i.id, i]));

  for (const r of reservations) {
    const it = itemMap.get(r.itemId);
    if (!it) continue;
    const arr = byItem.get(r.itemId) ?? [];
    arr.push({ s: r.startsAt.getTime() - it.setupMinutes * MIN, e: r.endsAt.getTime() + it.teardownMinutes * MIN, q: r.qty });
    byItem.set(r.itemId, arr);
  }
  for (const o of outOfService) {
    const arr = byItem.get(o.itemId) ?? [];
    arr.push({ s: o.from.getTime(), e: o.until ? o.until.getTime() : Number.MAX_SAFE_INTEGER, q: o.units });
    byItem.set(o.itemId, arr);
  }

  for (const it of items) {
    if (it.kind === 'package') continue;
    if (it.active === false) { res.set(it.id, 0); continue; }
    const from = win.startsAt.getTime() - it.setupMinutes * MIN;
    const to = win.endsAt.getTime() + it.teardownMinutes * MIN;
    const used = peakUsage(byItem.get(it.id) ?? [], from, to);
    res.set(it.id, Math.max(0, it.quantity - used));
  }
  // packages: min over components of floor(free / per-package qty)
  for (const it of items) {
    if (it.kind !== 'package') continue;
    if (it.active === false || !it.bundle?.length) { res.set(it.id, 0); continue; }
    let n = Infinity;
    for (const c of it.bundle) n = Math.min(n, Math.floor((res.get(c.itemId) ?? 0) / Math.max(1, c.qty)));
    res.set(it.id, Number.isFinite(n) ? n : 0);
  }
  return res;
}

/** Validate a requested cart against free units. Returns conflicts (empty = OK). */
export function checkCart(
  items: InvItem[],
  reservations: Reservation[],
  outOfService: OutOfService[],
  win: Window,
  cart: { itemId: string; qty: number }[],
): { itemId: string; requested: number; free: number }[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const free = freeUnits(items, reservations, outOfService, win);
  const need = explode(cart, byId);
  const conflicts: { itemId: string; requested: number; free: number }[] = [];
  for (const n of need) {
    if (!byId.has(n.itemId)) { conflicts.push({ itemId: n.itemId, requested: n.qty, free: 0 }); continue; }
    const f = free.get(n.itemId) ?? 0;
    if (n.qty > f) conflicts.push({ itemId: n.itemId, requested: n.qty, free: f });
  }
  return conflicts;
}
