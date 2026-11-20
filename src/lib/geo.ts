/** Delivery zones + route optimisation (pure). */

export interface Zone { id: string; name: string; zips: string[]; radiusMiles: number | null; feeCents: number; minOrderCents: number; sort: number }

export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cheapest matching zone: explicit ZIP match first, then radius from base. */
export function matchZone(zones: Zone[], zip: string, point?: { lat: number; lng: number } | null, base?: { lat: number; lng: number } | null): Zone | null {
  const z = zip.trim().slice(0, 5);
  const sorted = [...zones].sort((a, b) => a.sort - b.sort || a.feeCents - b.feeCents);
  const byZip = sorted.find((zn) => zn.zips.includes(z));
  if (byZip) return byZip;
  if (point && base) {
    const d = haversineMiles(point, base);
    const byRadius = sorted.filter((zn) => zn.radiusMiles != null && d <= zn.radiusMiles!).sort((a, b) => a.radiusMiles! - b.radiusMiles!);
    if (byRadius[0]) return byRadius[0];
  }
  return null;
}

export interface Stop { id: string; lat: number; lng: number; dueBy: number }

/**
 * Order delivery stops: nearest-neighbour seeded by deadline, then 2-opt
 * improvement that never makes a stop late versus the seed order.
 * Average speed assumption converts miles → minutes.
 */
export function planRoute(depot: { lat: number; lng: number }, stops: Stop[], opts: { mph?: number; serviceMin?: number; startAt?: number } = {}) {
  const mph = opts.mph ?? 30, service = (opts.serviceMin ?? 30) * 60_000;
  const legMs = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => (haversineMiles(a, b) / mph) * 3_600_000;

  const evaluate = (order: Stop[]) => {
    let t = opts.startAt ?? Math.min(...order.map((s) => s.dueBy)) - 2 * 3_600_000;
    let pos = depot, miles = 0, late = 0;
    const etas: number[] = [];
    for (const s of order) {
      miles += haversineMiles(pos, s); t += legMs(pos, s); etas.push(t);
      if (t > s.dueBy) late += t - s.dueBy;
      t += service; pos = s;
    }
    miles += haversineMiles(pos, depot);
    return { miles, late, etas };
  };

  if (stops.length <= 1) { const e = evaluate(stops); return { order: stops, ...e }; }

  // seed: earliest deadline first, ties broken by nearest
  const remaining = [...stops].sort((a, b) => a.dueBy - b.dueBy);
  const order: Stop[] = [];
  let pos: { lat: number; lng: number } = depot;
  while (remaining.length) {
    const earliest = remaining[0].dueBy;
    const window = remaining.filter((s) => s.dueBy - earliest <= 90 * 60_000);
    window.sort((a, b) => haversineMiles(pos, a) - haversineMiles(pos, b));
    const next = window[0];
    order.push(next); remaining.splice(remaining.indexOf(next), 1); pos = next;
  }

  let best = order, bestEval = evaluate(order);
  let improved = true, guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const e = evaluate(cand);
        if (e.late <= bestEval.late && e.miles < bestEval.miles - 0.01) { best = cand; bestEval = e; improved = true; }
      }
    }
  }
  return { order: best, ...bestEval };
}

export function googleMapsDirections(depot: { lat: number; lng: number }, stops: { lat: number; lng: number }[]) {
  const p = (x: { lat: number; lng: number }) => `${x.lat},${x.lng}`;
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('origin', p(depot));
  u.searchParams.set('destination', p(depot));
  if (stops.length) u.searchParams.set('waypoints', stops.map(p).join('|'));
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
}
