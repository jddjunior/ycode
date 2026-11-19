/**
 * Manual booking / phone-quote builder. Live availability per item and a
 * live priceCart quote (via /api/app/ops/quote); submits a normal form POST
 * to /app/bookings/new so the server re-validates and creates the booking.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

export interface BuilderItem { id: string; name: string; kind: string; priceCents: number; quantity: number; image?: string; category: string; active: boolean }
export interface BuilderCustomer { id: string; name: string; email: string; phone: string }
export interface BuilderProps {
  items: BuilderItem[];
  customers: BuilderCustomer[];
  surfaces: { key: string; label: string; feeCents: number }[];
  hasWaiver: boolean;
  prefill: {
    day: string; startHour: number; endHour: number; zip: string; lines: { itemId: string; qty: number }[];
    customerId?: string; name?: string; email?: string; phone?: string; address?: string; city?: string; state?: string;
    notes?: string; leadId?: string; eventType?: string; damageWaiver: boolean; surface?: string; status?: string; coupon?: string;
  };
  error?: string;
}

interface QuoteResp {
  free: Record<string, number>;
  rule: { reason: string; message: string } | null;
  priced: null | {
    quote: { lines: { itemId: string; name: string; qty: number; unitCents: number; totalCents: number }[]; subtotalCents: number; deliveryCents: number; surfaceCents: number; damageWaiverCents: number; discountCents: number; taxCents: number; customerFeeCents: number; totalCents: number; depositCents: number };
    zone: { name: string } | null; deliverable: boolean; belowMinimum: boolean;
    conflicts: { itemId: string; requested: number; free: number }[]; coupon: { code: string } | null;
  };
}

const money = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: c % 100 === 0 ? 0 : 2 }).format(c / 100);
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

export default function BookingBuilder(p: BuilderProps) {
  const pf = p.prefill;
  const [day, setDay] = useState(pf.day);
  const [startHour, setStart] = useState(pf.startHour);
  const [endHour, setEnd] = useState(pf.endHour);
  const [overnight, setOvernight] = useState(false);
  const [zip, setZip] = useState(pf.zip);
  const [surface, setSurface] = useState(pf.surface ?? p.surfaces[0]?.key ?? 'grass');
  const [waiver, setWaiver] = useState(pf.damageWaiver);
  const [coupon, setCoupon] = useState(pf.coupon ?? '');
  const [cart, setCart] = useState<Record<string, number>>(() => Object.fromEntries(pf.lines.map((l) => [l.itemId, l.qty])));
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'existing' | 'new'>(pf.customerId ? 'existing' : 'new');
  const [custQ, setCustQ] = useState('');
  const [customerId, setCustomerId] = useState(pf.customerId ?? '');
  const [q, setQ] = useState<QuoteResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [netErr, setNetErr] = useState('');
  const seq = useRef(0);

  const lines = useMemo(() => Object.entries(cart).filter(([, n]) => n > 0).map(([itemId, qty]) => ({ itemId, qty })), [cart]);

  useEffect(() => {
    const my = ++seq.current;
    setLoading(true);
    const h = setTimeout(async () => {
      try {
        const res = await fetch('/api/app/ops/quote', {
          method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ day, startHour, endHour, overnight, lines, zip, surface, damageWaiver: waiver, coupon: coupon || undefined }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as QuoteResp;
        if (my === seq.current) { setQ(j); setNetErr(''); }
      } catch { if (my === seq.current) setNetErr('Couldn’t check availability — retrying when you change something.'); }
      finally { if (my === seq.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(h);
  }, [day, startHour, endHour, overnight, zip, surface, waiver, coupon, lines]);

  const bump = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(20, (c[id] ?? 0) + d)) }));
  const items = p.items.filter((i) => i.active && (!filter || i.name.toLowerCase().includes(filter.toLowerCase()) || i.category.toLowerCase().includes(filter.toLowerCase())));
  const custMatches = custQ.length < 2 ? [] : p.customers.filter((c) => [c.name, c.email, c.phone].join(' ').toLowerCase().includes(custQ.toLowerCase())).slice(0, 6);
  const chosen = p.customers.find((c) => c.id === customerId);
  const conflicts = new Set(q?.priced?.conflicts.map((c) => c.itemId) ?? []);
  const pr = q?.priced;
  const canSubmit = lines.length > 0 && (mode === 'new' || !!customerId) && !conflicts.size;

  return (
    <form method="post" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      {pf.leadId && <input type="hidden" name="leadId" value={pf.leadId} />}
      <div class="space-y-6 min-w-0">
        {p.error && <p role="alert" class="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">{p.error}</p>}

        <section class="card p-5" aria-labelledby="when-h">
          <h2 id="when-h" class="font-bold text-lg">1 · When & where</h2>
          <div class="grid gap-3 sm:grid-cols-4 mt-3">
            <div class="sm:col-span-2"><label class="label" for="day">Event date</label><input id="day" name="day" type="date" class="input" value={day} required onInput={(e) => setDay((e.target as HTMLInputElement).value)} /></div>
            <div><label class="label" for="startHour">Start</label>
              <select id="startHour" name="startHour" class="input" value={String(startHour)} onChange={(e) => setStart(Number((e.target as HTMLSelectElement).value))}>{HOURS.map((h) => <option value={h}>{hourLabel(h)}</option>)}</select></div>
            <div><label class="label" for="endHour">End</label>
              <select id="endHour" name="endHour" class="input" value={String(endHour)} onChange={(e) => setEnd(Number((e.target as HTMLSelectElement).value))}>{HOURS.map((h) => <option value={h}>{hourLabel(h)}</option>)}</select></div>
          </div>
          <label class="mt-3 inline-flex items-center gap-2 text-sm"><input type="checkbox" name="overnight" checked={overnight} onChange={(e) => setOvernight((e.target as HTMLInputElement).checked)} />Overnight rental (pickup next morning)</label>
          <div class="grid gap-3 sm:grid-cols-6 mt-3">
            <div class="sm:col-span-3"><label class="label" for="address">Street address</label><input id="address" name="address" class="input" autocomplete="street-address" value={pf.address ?? ''} required /></div>
            <div class="sm:col-span-1"><label class="label" for="city">City</label><input id="city" name="city" class="input" value={pf.city ?? ''} /></div>
            <div class="sm:col-span-1"><label class="label" for="state">State</label><input id="state" name="state" class="input" maxLength={2} value={pf.state ?? ''} /></div>
            <div class="sm:col-span-1"><label class="label" for="zip">ZIP</label><input id="zip" name="zip" class="input" inputMode="numeric" maxLength={10} value={zip} required onInput={(e) => setZip((e.target as HTMLInputElement).value)} /></div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 mt-3">
            <div><label class="label" for="surface">Setup surface</label>
              <select id="surface" name="surface" class="input" value={surface} onChange={(e) => setSurface((e.target as HTMLSelectElement).value)}>
                {(p.surfaces.length ? p.surfaces : [{ key: 'grass', label: 'Grass', feeCents: 0 }]).map((s) => <option value={s.key}>{s.label}{s.feeCents ? ` (+${money(s.feeCents)})` : ''}</option>)}
              </select></div>
            <div><label class="label" for="eventType">Event type</label>
              <select id="eventType" name="eventType" class="input" value={pf.eventType ?? 'birthday'}>
                {['birthday', 'school', 'church', 'corporate', 'community', 'wedding', 'other'].map((x) => <option value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
              </select></div>
          </div>
          {q?.rule && <p class="mt-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">Online rule: {q.rule.message} <span class="font-semibold">Manual bookings can override this.</span></p>}
        </section>

        <section class="card p-5" aria-labelledby="items-h">
          <div class="flex flex-wrap items-center gap-3">
            <h2 id="items-h" class="font-bold text-lg">2 · Items</h2>
            <span class="text-xs text-ink-2" aria-live="polite">{loading ? 'Checking availability…' : 'Live availability for this window'}</span>
            <div class="sm:ml-auto w-full sm:w-56"><label class="sr-only" for="itemq">Filter items</label><input id="itemq" class="input" type="search" placeholder="Filter items" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} /></div>
          </div>
          {netErr && <p class="text-sm text-red-700 mt-2">{netErr}</p>}
          <ul class="mt-4 grid gap-2 sm:grid-cols-2">
            {items.map((it) => {
              const free = q?.free?.[it.id];
              const n = cart[it.id] ?? 0;
              const over = conflicts.has(it.id);
              const out = free === 0 && n === 0;
              return (
                <li class={`rounded-xl border p-3 flex items-center gap-3 ${n ? 'border-brand bg-brand-soft/40' : 'border-line'} ${over ? '!border-red-300 !bg-red-50' : ''}`}>
                  {it.image ? <img src={it.image} alt="" class="size-12 rounded-lg object-cover bg-canvas shrink-0" loading="lazy" /> : <span class="size-12 rounded-lg bg-canvas shrink-0" />}
                  <div class="min-w-0 flex-1">
                    <p class={`text-sm font-semibold truncate ${out ? 'text-ink-2' : ''}`}>{it.name}</p>
                    <p class="text-xs text-ink-2">{money(it.priceCents)} · {it.kind === 'package' ? 'Package' : it.kind === 'addon' ? 'Add-on' : it.category}</p>
                    <p class={`text-xs font-semibold mt-0.5 ${free === undefined ? 'text-ink-2' : free === 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {free === undefined ? '…' : free === 0 ? 'Booked out' : `${free} of ${it.kind === 'package' ? free : it.quantity} free`}{over && ' — over capacity'}
                    </p>
                  </div>
                  <div class="flex items-center gap-1" role="group" aria-label={`Quantity of ${it.name}`}>
                    <button type="button" class="btn-ghost !px-0 size-9 !min-h-9" aria-label={`Remove one ${it.name}`} disabled={!n} onClick={() => bump(it.id, -1)}>−</button>
                    <span class="w-6 text-center text-sm font-bold tabular-nums" aria-live="polite">{n}</span>
                    <button type="button" class="btn-ghost !px-0 size-9 !min-h-9" aria-label={`Add one ${it.name}`} disabled={free !== undefined && n >= free} onClick={() => bump(it.id, 1)}>+</button>
                  </div>
                </li>
              );
            })}
          </ul>
          {items.length === 0 && <p class="text-sm text-ink-2 mt-3">No items match. <a class="text-brand font-semibold" href="/app/inventory/new">Add inventory</a></p>}
        </section>

        <section class="card p-5" aria-labelledby="cust-h">
          <h2 id="cust-h" class="font-bold text-lg">3 · Customer</h2>
          <div class="inline-flex rounded-xl border border-line p-1 mt-3" role="radiogroup" aria-label="Customer type">
            <button type="button" role="radio" aria-checked={mode === 'new'} class={`px-3 py-1.5 rounded-lg text-sm font-semibold ${mode === 'new' ? 'bg-brand-soft text-brand' : 'text-ink-2'}`} onClick={() => setMode('new')}>New customer</button>
            <button type="button" role="radio" aria-checked={mode === 'existing'} class={`px-3 py-1.5 rounded-lg text-sm font-semibold ${mode === 'existing' ? 'bg-brand-soft text-brand' : 'text-ink-2'}`} onClick={() => setMode('existing')}>Existing customer</button>
          </div>
          {mode === 'existing' ? (
            <div class="mt-3">
              <input type="hidden" name="customerId" value={customerId} />
              {chosen ? (
                <div class="rounded-xl border border-brand bg-brand-soft/40 p-3 flex items-center gap-3">
                  <div class="min-w-0 flex-1"><p class="font-semibold text-sm">{chosen.name}</p><p class="text-xs text-ink-2 truncate">{chosen.email} · {chosen.phone}</p></div>
                  <button type="button" class="text-sm font-semibold text-brand" onClick={() => setCustomerId('')}>Change</button>
                </div>
              ) : (
                <>
                  <label class="label" for="custq">Search customers</label>
                  <input id="custq" class="input" type="search" placeholder="Name, email or phone" value={custQ} onInput={(e) => setCustQ((e.target as HTMLInputElement).value)} autoComplete="off" />
                  <ul class="mt-2 divide-y divide-line rounded-xl border border-line empty:hidden">
                    {custMatches.map((c) => <li><button type="button" class="w-full text-left px-3 py-2 hover:bg-canvas" onClick={() => { setCustomerId(c.id); setCustQ(''); }}><span class="text-sm font-semibold">{c.name || c.email}</span> <span class="text-xs text-ink-2">{c.email} {c.phone}</span></button></li>)}
                  </ul>
                  {custQ.length >= 2 && !custMatches.length && <p class="hint">No match — switch to “New customer”.</p>}
                </>
              )}
            </div>
          ) : (
            <div class="grid gap-3 sm:grid-cols-3 mt-3">
              <div><label class="label" for="name">Name</label><input id="name" name="name" class="input" autoComplete="name" value={pf.name ?? ''} required /></div>
              <div><label class="label" for="email">Email</label><input id="email" name="email" type="email" class="input" autoComplete="email" value={pf.email ?? ''} required /></div>
              <div><label class="label" for="phone">Phone</label><input id="phone" name="phone" type="tel" class="input" autoComplete="tel" value={pf.phone ?? ''} /></div>
            </div>
          )}
          <div class="mt-3"><label class="label" for="notes">Notes</label><textarea id="notes" name="notes" class="input" rows={3} placeholder="Gate code, setup location, call before arrival…">{pf.notes ?? ''}</textarea></div>
        </section>
      </div>

      <aside class="lg:sticky lg:top-20 self-start space-y-4">
        <section class="card p-5" aria-labelledby="sum-h" aria-live="polite">
          <h2 id="sum-h" class="font-bold text-lg">Quote</h2>
          {!pr ? <p class="text-sm text-ink-2 mt-2">Add items to see a live price.</p> : (
            <>
              <ul class="mt-3 space-y-1.5 text-sm">
                {pr.quote.lines.map((l) => <li class="flex justify-between gap-3"><span class="min-w-0 truncate">{l.qty > 1 ? `${l.qty}× ` : ''}{l.name}</span><span class="tabular-nums">{money(l.totalCents)}</span></li>)}
              </ul>
              <dl class="mt-3 pt-3 border-t border-line space-y-1 text-sm">
                {([['Delivery' + (pr.zone ? ` (${pr.zone.name})` : ''), pr.quote.deliveryCents], ['Surface', pr.quote.surfaceCents], ['Damage waiver', pr.quote.damageWaiverCents], ['Discount', -pr.quote.discountCents], ['Tax', pr.quote.taxCents], ['Service fee', pr.quote.customerFeeCents]] as [string, number][]).filter(([, v]) => v).map(([k, v]) => (
                  <div class="flex justify-between gap-3"><dt class="text-ink-2">{k}</dt><dd class="tabular-nums">{v < 0 ? `−${money(-v)}` : money(v)}</dd></div>
                ))}
                <div class="flex justify-between gap-3 pt-2 border-t border-line font-bold text-base"><dt>Total</dt><dd class="tabular-nums">{money(pr.quote.totalCents)}</dd></div>
                <div class="flex justify-between gap-3 text-ink-2"><dt>Deposit</dt><dd class="tabular-nums">{money(pr.quote.depositCents)}</dd></div>
              </dl>
              {!pr.deliverable && <p class="mt-3 text-sm rounded-lg bg-amber-50 text-amber-900 px-3 py-2">ZIP {zip || '—'} is outside your delivery zones — no delivery fee applied.</p>}
              {pr.belowMinimum && <p class="mt-2 text-sm rounded-lg bg-amber-50 text-amber-900 px-3 py-2">Below this zone’s order minimum (allowed for manual bookings).</p>}
              {pr.conflicts.length > 0 && <p class="mt-2 text-sm rounded-lg bg-red-50 text-red-800 px-3 py-2" role="alert">Some items aren’t available for this window. Reduce quantity or pick another time.</p>}
            </>
          )}
          {p.hasWaiver && <label class="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" name="damageWaiver" checked={waiver} onChange={(e) => setWaiver((e.target as HTMLInputElement).checked)} />Include damage waiver</label>}
          <div class="mt-3"><label class="label" for="coupon">Coupon</label><input id="coupon" name="coupon" class="input uppercase" value={coupon} onInput={(e) => setCoupon((e.target as HTMLInputElement).value.trim())} />
            {coupon && pr && <p class={`hint ${pr.coupon ? 'text-green-700' : 'text-red-700'}`}>{pr.coupon ? `${pr.coupon.code} applied` : 'Code not valid'}</p>}</div>
          <fieldset class="mt-4">
            <legend class="label">Save as</legend>
            <div class="grid grid-cols-3 gap-2 text-sm">
              {[['confirmed', 'Confirmed'], ['pending', 'Pending'], ['quote', 'Quote']].map(([v, l]) => (
                <label class="flex items-center justify-center gap-1.5 rounded-xl border border-line min-h-11 has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand font-semibold"><input type="radio" name="status" value={v} class="sr-only" defaultChecked={(pf.status ?? 'confirmed') === v} />{l}</label>
              ))}
            </div>
          </fieldset>
          <button class="btn-primary w-full mt-4" disabled={!canSubmit}>Create booking{pr ? ` · ${money(pr.quote.totalCents)}` : ''}</button>
          {!canSubmit && <p class="hint text-center">{!lines.length ? 'Add at least one item.' : mode === 'existing' && !customerId ? 'Pick a customer.' : 'Resolve availability conflicts.'}</p>}
        </section>
      </aside>
    </form>
  );
}
