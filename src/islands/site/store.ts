/** Client-side cart/event state shared by the storefront islands (localStorage, per tenant). */
export interface CartLine { itemId: string; qty: number }
export interface CartState {
  day?: string; startHour?: number; endHour?: number; zip?: string;
  lines: CartLine[];
  leadId?: string | null;
  holdToken?: string | null;
  contact?: { name?: string; email?: string; phone?: string };
}

const key = (slug: string) => `bos:cart:${slug}`;

export function loadCart(slug: string): CartState {
  try {
    const v = JSON.parse(localStorage.getItem(key(slug)) ?? 'null');
    if (v && Array.isArray(v.lines)) return v as CartState;
  } catch { /* storage blocked */ }
  return { lines: [] };
}

export function saveCart(slug: string, c: CartState) {
  try { localStorage.setItem(key(slug), JSON.stringify(c)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('bos:cart', { detail: c })); } catch { /* ignore */ }
}

export function addLines(c: CartState, lines: CartLine[]): CartState {
  const m = new Map(c.lines.map((l) => [l.itemId, l.qty]));
  for (const l of lines) m.set(l.itemId, Math.min(20, (m.get(l.itemId) ?? 0) + l.qty));
  return { ...c, lines: [...m].map(([itemId, qty]) => ({ itemId, qty })) };
}

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

export const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 || h === 24 ? 'am' : 'pm'}`;

export const prettyDay = (day: string, long = false) =>
  new Intl.DateTimeFormat('en-US', long ? { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' } : { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(day + 'T12:00:00Z'));

export const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8am … 10pm

export interface AvailResponse {
  ok: boolean; reason: string | null; message: string | null; day: string; startHour: number; endHour: number; hours: number;
  available: number;
  items: { id: string; slug: string; kind: string; quantity: number; free: number }[];
  zone: { known: boolean; deliverable: boolean; name: string | null; feeCents: number; minOrderCents: number } | null;
}

export async function fetchAvailability(api: string, day: string, start: number, end: number, zip?: string): Promise<AvailResponse | { error: string }> {
  const u = new URLSearchParams({ day, start: String(start), end: String(end) });
  if (zip && /^\d{5}$/.test(zip)) u.set('zip', zip);
  try {
    const r = await fetch(`${api}/availability?${u}`, { headers: { accept: 'application/json' } });
    const j = await r.json();
    if (!r.ok) return { error: j.message ?? 'Could not check that date.' };
    return j as AvailResponse;
  } catch {
    return { error: 'Network hiccup — please try again.' };
  }
}

export function zoneText(z: AvailResponse['zone'], zip: string) {
  if (!z || !z.known) return null;
  if (!z.deliverable) return { tone: 'bad' as const, text: `We don’t deliver to ${zip} online yet — text us and we’ll try.` };
  if (z.feeCents === 0) return { tone: 'ok' as const, text: `Free delivery & setup to ${zip}` };
  return { tone: 'ok' as const, text: `${money(z.feeCents)} delivery & setup to ${zip}${z.minOrderCents ? ` · ${money(z.minOrderCents)} minimum` : ''}` };
}
