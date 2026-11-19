/**
 * Guest checkout (no login): event → cart (+upsells, package nudge, live server quote)
 * → address & setup → contact (captures the abandoned-cart lead) → e-sign → deposit → payment.
 * Prices always come from the server quote; the client only shows list prices before one arrives.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { HOURS, nearbyOpenDates, fetchAvailability, hourLabel, loadCart, money, prettyDay, saveCart, zoneText, type AvailResponse, type CartLine, type CartState } from './store';

export interface CatalogItem {
  id: string; slug: string; name: string; kind: 'rental' | 'addon' | 'package'; priceCents: number; baseHours: number; extraHourCents: number;
  image: string; href: string; upsellIds: string[]; bundle: { itemId: string; qty: number }[]; isWet: boolean; tagline: string;
}
interface Props {
  slug: string; api: string; base: string; minDay: string; maxDay: string; defaultStart: number; defaultEnd: number;
  phone: string; tenantName: string; state: string; city: string;
  items: CatalogItem[]; surfaces: { key: string; label: string; feeCents: number }[];
  waiverBps: number; waiverDefaultOn: boolean; agreementHtml: string; cancellationPolicy: string;
  holdMinutes: number; depositText: string; canceled?: boolean;
  help?: { q: string; a: string }[];
}
interface Quote {
  lines: { itemId: string; name: string; qty: number; unitCents: number; totalCents: number }[];
  subtotalCents: number; deliveryCents: number; surfaceCents: number; damageWaiverCents: number; discountCents: number;
  taxCents: number; customerFeeCents: number; totalCents: number; depositCents: number; balanceCents: number;
  deliverable: boolean; belowMinimum: boolean; minOrderCents: number; conflicts: { itemId: string; requested: number; free: number }[];
  coupon: { code: string } | null; couponInvalid: boolean; hours: number;
}

const STEPS = ['Date', 'Cart', 'Setup', 'Contact', 'Sign', 'Pay'] as const;
const EVENT_TYPES = [['birthday', 'Birthday party'], ['school', 'School event'], ['church', 'Church event'], ['corporate', 'Company / corporate'], ['community', 'Block party / community'], ['wedding', 'Wedding / shower'], ['other', 'Something else']] as const;
const VENUES = [['home', 'Home / backyard'], ['park', 'Public park'], ['church', 'Church'], ['school', 'School'], ['business', 'Business / office'], ['other', 'Other']] as const;

export default function Checkout(p: Props) {
  const byId = useMemo(() => new Map(p.items.map((i) => [i.id, i])), []);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [day, setDay] = useState('');
  const [start, setStart] = useState(p.defaultStart);
  const [end, setEnd] = useState(p.defaultEnd);
  const [zip, setZip] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [surface, setSurface] = useState(p.surfaces[0]?.key ?? 'grass');
  const [waiver, setWaiver] = useState(p.waiverDefaultOn);
  const [coupon, setCoupon] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [f, setF] = useState({
    address: '', city: p.city, state: p.state, eventType: 'birthday', venue: 'home', power: 'yes', water: 'yes', notes: '',
    name: '', email: '', phone: '', celebrantName: '', celebrantBirthday: '', smsOptIn: true, marketingOptIn: false, signName: '', accepted: false,
  });
  const [leadId, setLeadId] = useState<string | null>(null);
  const [holdToken, setHoldToken] = useState<string | null>(null);
  const [avail, setAvail] = useState<AvailResponse | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qLoading, setQLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(p.canceled ? 'Payment was canceled — your cart is saved. You can try again whenever you’re ready.' : null);
  const [busy, setBusy] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const qSeq = useRef(0);

  // hydrate from storage
  useEffect(() => {
    const c = loadCart(p.slug);
    if (c.day && c.day >= p.minDay) setDay(c.day);
    if (c.startHour != null) setStart(c.startHour);
    if (c.endHour != null) setEnd(c.endHour);
    if (c.zip) setZip(c.zip);
    setLines(c.lines.filter((l) => byId.has(l.itemId)));
    setLeadId(c.leadId ?? null);
    setHoldToken(c.holdToken ?? null);
    if (c.contact) setF((x) => ({ ...x, name: c.contact?.name ?? '', email: c.contact?.email ?? '', phone: c.contact?.phone ?? '' }));
    let resumed = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`bos:co:${p.slug}`) ?? 'null');
      if (saved?.f) setF((x) => ({ ...x, ...saved.f, signName: '', accepted: false }));
      if (saved?.step > 1 && c.lines.length) { setStep(Math.min(saved.step, 4)); resumed = true; }
    } catch { /* ignore */ }
    if (!resumed && c.day && c.zip && c.lines.length) setStep(1);
    setReady(true);
  }, []);

  const endFixed = end > start ? end : Math.min(24, start + 4);
  const zipOk = /^\d{5}$/.test(zip);
  const windowReq = { day, startHour: start, endHour: endFixed };

  useEffect(() => {
    if (!ready) return;
    const c: CartState = { ...loadCart(p.slug), day, startHour: start, endHour: endFixed, zip, lines, leadId, holdToken, contact: { name: f.name, email: f.email, phone: f.phone } };
    saveCart(p.slug, c);
  }, [ready, day, start, endFixed, zip, lines, leadId, holdToken, f.name, f.email, f.phone]);

  // keep in-progress details across reloads / flaky networks (session only)
  useEffect(() => {
    if (!ready) return;
    try { const { signName: _s, accepted: _a, ...rest } = f; sessionStorage.setItem(`bos:co:${p.slug}`, JSON.stringify({ step, f: rest })); } catch { /* ignore */ }
  }, [ready, step, f]);

  // live availability for the event step
  useEffect(() => {
    if (!day) { setAvail(null); return; }
    let live = true;
    const h = setTimeout(async () => {
      const r = await fetchAvailability(p.api, day, start, endFixed, zip);
      if (live && !('error' in r)) setAvail(r);
    }, 200);
    return () => { live = false; clearTimeout(h); };
  }, [day, start, endFixed, zip]);

  // server quote
  useEffect(() => {
    if (!ready || !day || !zipOk || !lines.length) { setQuote(null); return; }
    const n = ++qSeq.current;
    setQLoading(true);
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`${p.api}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ window: windowReq, lines, zip, surface, damageWaiver: waiver, couponCode: coupon || null }) });
        const j = await r.json();
        if (n !== qSeq.current) return;
        setQuote(r.ok ? j : null);
      } catch { if (n === qSeq.current) setQuote(null); }
      if (n === qSeq.current) setQLoading(false);
    }, 250);
    return () => clearTimeout(h);
  }, [ready, day, start, endFixed, zip, lines, surface, waiver, coupon]);

  const set = (k: keyof typeof f) => (e: Event) => {
    const el = e.target as HTMLInputElement;
    setF((x) => ({ ...x, [k]: el.type === 'checkbox' ? el.checked : el.value }));
    setErrors((x) => { const { [k]: _, ...rest } = x; return rest; });
  };
  const go = (n: number) => { setStep(n); setBanner(null); requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
  const setQty = (itemId: string, qty: number) => setLines((ls) => qty <= 0 ? ls.filter((l) => l.itemId !== itemId) : ls.map((l) => l.itemId === itemId ? { ...l, qty: Math.min(20, qty) } : l));
  const add = (itemId: string) => setLines((ls) => ls.some((l) => l.itemId === itemId) ? ls.map((l) => l.itemId === itemId ? { ...l, qty: l.qty + 1 } : l) : [...ls, { itemId, qty: 1 }]);
  const freeOf = (id: string) => avail?.ok ? avail.items.find((i) => i.id === id)?.free ?? 0 : undefined;

  const inCart = new Set(lines.map((l) => l.itemId));
  const hasWet = lines.some((l) => byId.get(l.itemId)?.isWet);
  const upsells = useMemo(() => {
    const ids = new Set<string>();
    for (const l of lines) for (const u of byId.get(l.itemId)?.upsellIds ?? []) if (!inCart.has(u)) ids.add(u);
    if (f.power === 'no') { const g = p.items.find((i) => /generator/i.test(i.name)); if (g && !inCart.has(g.id)) ids.add(g.id); }
    return [...ids].map((id) => byId.get(id)).filter((x): x is CatalogItem => !!x).slice(0, 4);
  }, [lines, f.power]);

  const nudge = useMemo(() => {
    let best: { pkg: CatalogItem; missing: CatalogItem[]; savings: number; present: { itemId: string; qty: number }[] } | null = null;
    for (const pkg of p.items.filter((i) => i.kind === 'package' && !inCart.has(i.id))) {
      const present = pkg.bundle.filter((b) => (lines.find((l) => l.itemId === b.itemId)?.qty ?? 0) >= b.qty);
      if (!present.length) continue;
      const list = pkg.bundle.reduce((s, b) => s + (byId.get(b.itemId)?.priceCents ?? 0) * b.qty, 0);
      const savings = list - pkg.priceCents;
      if (savings <= 0) continue;
      const missing = pkg.bundle.filter((b) => !present.includes(b)).map((b) => byId.get(b.itemId)).filter((x): x is CatalogItem => !!x);
      if (!best || savings > best.savings) best = { pkg, missing, savings, present };
    }
    return best;
  }, [lines]);

  const applyNudge = () => {
    if (!nudge) return;
    setLines((ls) => {
      const next = ls.map((l) => { const b = nudge.pkg.bundle.find((x) => x.itemId === l.itemId); return b ? { ...l, qty: l.qty - b.qty } : l; }).filter((l) => l.qty > 0);
      return [...next, { itemId: nudge.pkg.id, qty: 1 }];
    });
  };

  const [alts, setAlts] = useState<string[] | null>(null);
  useEffect(() => {
    setAlts(null);
    const conflictsNow = quote?.conflicts.map((c) => c.itemId) ?? [];
    if (!day || !(avail && (!avail.ok || conflictsNow.length))) return;
    let live = true;
    nearbyOpenDates(p.api, day, start, endFixed, p.minDay, p.maxDay, conflictsNow.length ? conflictsNow : []).then((d) => { if (live) setAlts(d); });
    return () => { live = false; };
  }, [avail, quote?.conflicts.length]);
  const altDates = alts && alts.length > 0 && (
    <div class="rounded-2xl bg-soft p-3">
      <p class="text-sm font-extrabold">Open nearby{quote?.conflicts.length ? ' for those items' : ''}:</p>
      <div class="mt-2 flex flex-wrap gap-2">{alts.map((d) => <button type="button" class="s-filter !min-h-11 !text-sm" onClick={() => setDay(d)}>{prettyDay(d)}</button>)}</div>
    </div>
  );
  const conflictIds = new Set((quote?.conflicts ?? []).map((c) => c.itemId));
  const rulesBlocked = avail && !avail.ok;
  const zoneInfo = avail && zipOk ? zoneText(avail.zone, zip) : null;

  /* ── step validation ── */
  function validate(s: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!day) e.day = 'Pick your event date';
      if (!zipOk) e.zip = 'Enter a 5-digit ZIP';
    }
    if (s === 1) {
      if (!lines.length) e.cart = 'Add at least one rental to continue.';
      else if (quote?.conflicts.length) e.cart = 'Some items aren’t available for your time — remove or swap them.';
      else if (quote && !quote.deliverable) e.cart = 'We don’t deliver to that ZIP online yet — text us and we’ll see what we can do.';
      else if (quote?.belowMinimum) e.cart = `Orders to your area have a ${money(quote.minOrderCents)} minimum — add another item.`;
    }
    if (s === 2) {
      if (f.address.trim().length < 4) e.address = 'Enter the street address';
      if (f.city.trim().length < 2) e.city = 'Enter the city';
    }
    if (s === 3) {
      if (f.name.trim().length < 2) e.name = 'Enter your name';
      if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Enter a valid email';
      if (f.phone.replace(/\D/g, '').length < 10) e.phone = 'Enter a mobile number';
    }
    if (s === 4) {
      if (f.signName.trim().length < 2) e.signName = 'Type your full name to sign';
      if (!f.accepted) e.accepted = 'Please accept the rental agreement';
    }
    return e;
  }

  async function next(s: number) {
    const e = validate(s);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (s === 0 && rulesBlocked) return;
    if (s === 3) captureLead();
    if (s === 4 && !f.signName) setF((x) => ({ ...x, signName: x.name }));
    go(s + 1);
  }

  async function captureLead() {
    try {
      const r = await fetch(`${p.api}/lead`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadId, name: f.name, email: f.email, phone: f.phone, eventDate: day, zip, cart: lines, source: 'abandoned_checkout',
          message: `Checkout started: ${lines.map((l) => `${l.qty}× ${byId.get(l.itemId)?.name}`).join(', ')} · ${hourLabel(start)}–${hourLabel(endFixed)} · ${f.address}, ${f.city}` }),
      });
      const j = await r.json();
      if (j.leadId) setLeadId(j.leadId);
    } catch { /* non-blocking */ }
  }

  const FIELD_STEP: Record<string, number> = { 'window.day': 0, 'window.endHour': 0, zip: 0, lines: 1, address: 2, city: 2, state: 2, 'customer.name': 3, 'customer.email': 3, 'customer.phone': 3, 'agreement.name': 4, 'agreement.accepted': 4 };
  async function book() {
    setBusy(true); setBanner(null);
    try {
      const r = await fetch(`${p.api}/book`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          window: windowReq, lines, zip, surface, damageWaiver: waiver, couponCode: coupon || null,
          customer: { name: f.name, email: f.email, phone: f.phone, celebrantName: f.celebrantName || null, celebrantBirthday: f.celebrantBirthday || null, smsOptIn: f.smsOptIn, marketingOptIn: f.marketingOptIn },
          address: f.address, city: f.city, state: f.state, eventType: f.eventType, venue: f.venue, power: f.power, water: hasWet ? f.water : 'na', notes: f.notes,
          agreement: { name: f.signName, accepted: f.accepted }, leadId, replaceToken: holdToken,
        }),
      });
      const j = await r.json();
      if (r.ok && j.url) {
        setHoldToken(j.token);
        saveCart(p.slug, { ...loadCart(p.slug), holdToken: j.token, leadId });
        location.href = j.url;
        return;
      }
      setBusy(false);
      setBanner(j.message ?? 'Something went wrong. Please try again.');
      if (j.code === 'unavailable' || j.code === 'minimum' || j.code === 'empty') go(1);
      else if (j.code === 'undeliverable' || j.code === 'rules') go(0);
      else if (j.code === 'invalid' && j.detail) {
        const first = Object.keys(j.detail)[0];
        const target = Object.entries(FIELD_STEP).find(([k]) => first?.startsWith(k))?.[1];
        if (target != null) go(target);
      }
    } catch {
      setBusy(false);
      setBanner('Network hiccup — please try again. Your cart is saved.');
    }
  }

  /* ── UI pieces ── */
  const Err = ({ k }: { k: string }) => (errors[k] ? <p class="s-err" id={`err-${k}`}>{errors[k]}</p> : null);
  const inv = (k: string) => (errors[k] ? { 'aria-invalid': 'true' as const, 'aria-describedby': `err-${k}` } : {});
  const Nav = ({ s, label, onNext, disabled }: { s: number; label: string; onNext?: () => void; disabled?: boolean }) => (
    <div class="mt-6 flex flex-col-reverse sm:flex-row gap-3 sm:items-center sm:justify-between">
      {s > 0 ? <button type="button" class="s-btn s-btn-ghost" onClick={() => go(s - 1)}>← Back</button> : <a class="s-btn s-btn-ghost" href={`${p.base}/rentals`}>Browse rentals</a>}
      <button type="button" class="s-btn s-btn-cta s-btn-lg" disabled={disabled} onClick={onNext ?? (() => next(s))}>{label}</button>
    </div>
  );
  const Row = ({ label, cents, neg, strong, free }: { label: string; cents: number; neg?: boolean; strong?: boolean; free?: boolean }) => (
    <div class={`flex justify-between gap-3 ${strong ? 'text-base font-extrabold' : 'text-sm'}`}><span>{label}</span><span class="s-price">{free && cents === 0 ? 'Free' : `${neg ? '−' : ''}${money(cents)}`}</span></div>
  );

  const summary = (
    <aside class="s-card p-5 lg:sticky lg:top-24" aria-label="Order summary">
      <div class="flex items-center justify-between gap-2">
        <h2 class="s-h3">Your party</h2>
        {qLoading && <span class="text-xs font-bold s-sub">Updating…</span>}
      </div>
      {day && <p class="mt-1 text-sm font-bold">{prettyDay(day, true)} · {hourLabel(start)}–{hourLabel(endFixed)}{zipOk ? ` · ${zip}` : ''}</p>}
      {step > 0 && <p class="mt-1 flex gap-4 text-sm"><button type="button" class="font-bold text-primary underline underline-offset-2 min-h-8" onClick={() => go(0)}>Edit date & ZIP</button>{step > 1 && <button type="button" class="font-bold text-primary underline underline-offset-2 min-h-8" onClick={() => go(1)}>Edit cart</button>}</p>}
      <ul class="mt-4 grid gap-3">
        {lines.map((l) => {
          const it = byId.get(l.itemId); if (!it) return null;
          const ql = quote?.lines.find((x) => x.itemId === l.itemId);
          return (
            <li class="flex gap-3 items-center">
              <img src={it.image} alt="" width={56} height={42} class="w-14 h-[42px] rounded-lg object-cover bg-muted" />
              <span class="flex-1 text-sm font-bold leading-tight">{l.qty > 1 ? `${l.qty} × ` : ''}{it.name}{conflictIds.has(it.id) && <span class="block s-err !mt-0">Not available</span>}</span>
              <span class="s-price text-sm">{money(ql?.totalCents ?? it.priceCents * l.qty)}</span>
            </li>
          );
        })}
        {!lines.length && <li class="text-sm s-sub">Your cart is empty.</li>}
      </ul>
      {quote && (
        <div class="mt-4 grid gap-1.5 border-t border-line pt-4">
          <Row label="Rentals" cents={quote.subtotalCents} />
          <Row label="Delivery, setup & pickup" cents={quote.deliveryCents} free />
          {quote.surfaceCents > 0 && <Row label="Surface setup (sandbags/tarps)" cents={quote.surfaceCents} />}
          {quote.damageWaiverCents > 0 && <Row label="Damage waiver" cents={quote.damageWaiverCents} />}
          {quote.discountCents > 0 && <Row label={`Discount${quote.coupon ? ` (${quote.coupon.code})` : ''}`} cents={quote.discountCents} neg />}
          {quote.taxCents > 0 && <Row label="Sales tax" cents={quote.taxCents} />}
          {quote.customerFeeCents > 0 && <Row label="Online booking fee" cents={quote.customerFeeCents} />}
          <div class="mt-2 border-t border-line pt-2"><Row label="Total" cents={quote.totalCents} strong /></div>
          <div class="mt-2 rounded-xl bg-soft p-3 grid gap-1">
            <Row label="Due today (deposit)" cents={quote.depositCents} strong />
            <Row label="Balance due on delivery" cents={quote.balanceCents} />
          </div>
        </div>
      )}
      {!quote && lines.length > 0 && <p class="mt-4 text-sm s-sub">{!day || !zipOk ? 'Add your date and ZIP to see delivery, tax and your deposit.' : 'Calculating your total…'}</p>}
      <p class="mt-4 text-xs s-sub">{p.depositText}. {p.cancellationPolicy}</p>
      {!!p.help?.length && (
        <div class="mt-5 border-t border-line pt-4">
          <p class="font-extrabold text-sm">Questions before you book?</p>
          <div class="mt-1">
            {p.help.map((h) => (
              <details class="s-faq !border-line">
                <summary class="!min-h-11 !py-2 !text-sm">{h.q}</summary>
                <p class="!text-sm !pb-3">{h.a}</p>
              </details>
            ))}
          </div>
          {p.phone && (
            <div class="mt-3 grid grid-cols-2 gap-2">
              <a class="s-btn s-btn-ghost s-btn-sm" href={`sms:${p.phone.replace(/[^\d+]/g, '')}`}>Text us</a>
              <a class="s-btn s-btn-ghost s-btn-sm" href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}>Call {p.phone}</a>
            </div>
          )}
        </div>
      )}
    </aside>
  );

  const stepHeader = (
    <>
    <p class="text-sm font-extrabold s-sub mb-2" aria-live="polite">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
    <ol class="grid grid-cols-6 gap-1.5 mb-6" aria-label="Checkout progress">
      {STEPS.map((s, i) => (
        <li aria-current={i === step ? 'step' : undefined}>
          {i < step ? (
            <button type="button" class="w-full grid gap-1.5 text-left min-h-11" onClick={() => go(i)} aria-label={`Back to ${s}`}>
              <span class="h-2 rounded-full bg-primary" />
              <span class="text-[11px] sm:text-xs font-bold underline underline-offset-2">{s}</span>
            </button>
          ) : (
            <span class="grid gap-1.5 min-h-11">
              <span class={`h-2 rounded-full ${i === step ? 'bg-primary' : 'bg-muted'}`} />
              <span class={`text-[11px] sm:text-xs font-bold ${i === step ? '' : 's-sub'}`}>{s}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
    </>
  );

  let body;
  if (step === 0) {
    body = (
      <section>
        <h2 class="s-h2 !text-2xl sm:!text-3xl">When and where is the party?</h2>
        <p class="s-sub mt-1">We’ll show what’s actually free and your delivery fee before you add a single thing.</p>
        <div class="mt-5 grid grid-cols-2 gap-3">
          <div class="col-span-2 sm:col-span-1">
            <label class="s-label" for="co-day">Event date</label>
            <input id="co-day" type="date" class="s-input" min={p.minDay} max={p.maxDay} value={day} onInput={(e) => { setDay((e.target as HTMLInputElement).value); setErrors({}); }} {...inv('day')} />
            {Err({ k: 'day' })}
          </div>
          <div class="col-span-2 sm:col-span-1">
            <label class="s-label" for="co-zip">Delivery ZIP</label>
            <input id="co-zip" class="s-input" inputMode="numeric" autoComplete="postal-code" maxLength={5} placeholder="e.g. 77008" value={zip} onInput={(e) => { setZip((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 5)); setErrors({}); }} {...inv('zip')} />
            {Err({ k: 'zip' })}
          </div>
          <div>
            <label class="s-label" for="co-start">Start time</label>
            <select id="co-start" class="s-input" value={String(start)} onChange={(e) => setStart(+(e.target as HTMLSelectElement).value)}>
              {HOURS.slice(0, -2).map((h) => <option value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
          <div>
            <label class="s-label" for="co-end">End time</label>
            <select id="co-end" class="s-input" value={String(endFixed)} onChange={(e) => setEnd(+(e.target as HTMLSelectElement).value)}>
              {HOURS.filter((h) => h > start).map((h) => <option value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
        </div>
        <div class="mt-4 grid gap-2" aria-live="polite">
          {avail && !avail.ok && <p class="s-chip s-chip-warn whitespace-normal">{avail.message}</p>}
          {avail && !avail.ok && altDates}
          {avail?.ok && <p class="s-chip s-chip-ok">● {avail.available} rentals open {prettyDay(day)}</p>}
          {zoneInfo && <p class={`s-chip ${zoneInfo.tone === 'ok' ? '' : 's-chip-bad'} whitespace-normal`}>{zoneInfo.text}</p>}
        </div>
        {Nav({ s: 0, label: lines.length ? 'Review my cart →' : 'Choose rentals →', onNext: () => {
          const e = validate(0); setErrors(e);
          if (Object.keys(e).length || rulesBlocked) return;
          if (!lines.length) { location.href = `${p.base}/rentals?date=${day}&start=${start}&end=${endFixed}&zip=${zip}`; return; }
          go(1);
        } })}
      </section>
    );
  } else if (step === 1) {
    body = (
      <section>
        <h2 class="s-h2 !text-2xl sm:!text-3xl">Review your cart</h2>
        <p class="s-sub mt-1">{prettyDay(day, true)} · {hourLabel(start)}–{hourLabel(endFixed)} · delivery to {zip} <button type="button" class="underline font-bold" onClick={() => go(0)}>Change</button></p>
        <ul class="mt-5 grid gap-3">
          {lines.map((l) => {
            const it = byId.get(l.itemId); if (!it) return null;
            const fr = freeOf(it.id);
            const conflict = conflictIds.has(it.id);
            return (
              <li class={`s-card p-3 flex gap-3 items-center ${conflict ? '!border-[var(--color-bad)]' : ''}`}>
                <img src={it.image} alt={it.name} width={96} height={72} class="w-24 h-[72px] rounded-xl object-cover bg-muted" />
                <div class="flex-1 min-w-0">
                  <a href={it.href} class="font-extrabold leading-tight hover:underline">{it.name}</a>
                  <p class="text-sm s-sub">{money(quote?.lines.find((x) => x.itemId === it.id)?.unitCents ?? it.priceCents)} each{it.kind === 'package' ? ' · package' : ''}</p>
                  {conflict ? <p class="s-err !mt-1">Not available for this time{fr ? ` — only ${fr} left` : ''}</p>
                    : fr === 1 ? <p class="text-xs font-bold text-warn mt-1">Last one for your date</p> : null}
                </div>
                <div class="flex items-center gap-1" role="group" aria-label={`Quantity for ${it.name}`}>
                  <button type="button" class="s-btn s-btn-ghost !min-h-11 !w-11 !p-0" aria-label="Decrease" onClick={() => setQty(it.id, l.qty - 1)}>−</button>
                  <span class="w-7 text-center s-price" aria-live="polite">{l.qty}</span>
                  <button type="button" class="s-btn s-btn-ghost !min-h-11 !w-11 !p-0" aria-label="Increase" onClick={() => setQty(it.id, l.qty + 1)}>+</button>
                </div>
              </li>
            );
          })}
        </ul>
        {!lines.length && <p class="mt-4 s-card p-5 text-center">Your cart is empty. <a class="font-extrabold underline" href={`${p.base}/rentals?date=${day}&zip=${zip}`}>Browse what’s available →</a></p>}
        {nudge && (
          <div class="mt-4 rounded-2xl border-2 border-dashed border-[var(--c-accent)] p-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-white">
            <div class="flex-1">
              <p class="font-extrabold">Make it the {nudge.pkg.name} and save {money(nudge.savings)}</p>
              <p class="text-sm s-sub">{nudge.missing.length ? `Adds ${nudge.missing.map((m) => m.name).join(' + ')}. ` : ''}{nudge.pkg.tagline}</p>
            </div>
            <button type="button" class="s-btn s-btn-primary s-btn-sm" onClick={applyNudge}>Switch to package</button>
          </div>
        )}
        {upsells.length > 0 && (
          <div class="mt-6">
            <h3 class="s-h3">Customers also add</h3>
            <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {upsells.map((u) => (
                <button type="button" class="s-card p-2 text-left grid gap-1.5 hover:border-[var(--c-primary)]" onClick={() => add(u.id)} disabled={freeOf(u.id) === 0}>
                  <img src={u.image} alt="" width={160} height={120} loading="lazy" class="w-full aspect-[4/3] rounded-lg object-cover bg-muted" />
                  <span class="text-sm font-bold leading-tight">{u.name}</span>
                  <span class="text-sm"><span class="s-price">+{money(u.priceCents)}</span> · <span class="font-bold text-primary">{freeOf(u.id) === 0 ? 'Booked' : 'Add'}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div class="mt-6 grid sm:grid-cols-2 gap-4">
          {p.waiverBps > 0 && (
            <label class="s-card p-4 flex gap-3 items-start cursor-pointer">
              <input type="checkbox" class="mt-1 size-5 accent-[var(--c-primary)]" checked={waiver} onChange={(e) => setWaiver((e.target as HTMLInputElement).checked)} />
              <span><span class="font-extrabold block">Damage waiver ({p.waiverBps / 100}%)</span><span class="text-sm s-sub">Covers accidental damage up to the rental value. Recommended.</span></span>
            </label>
          )}
          <form class="s-card p-4" onSubmit={(e) => { e.preventDefault(); setCoupon(couponInput.trim()); }}>
            <label class="s-label" for="co-coupon">Promo code</label>
            <div class="flex gap-2">
              <input id="co-coupon" class="s-input uppercase" value={couponInput} onInput={(e) => setCouponInput((e.target as HTMLInputElement).value)} placeholder="Optional" />
              <button class="s-btn s-btn-ghost s-btn-sm" type="submit">Apply</button>
            </div>
            {quote?.coupon && <p class="text-sm font-bold text-ok mt-1">✓ {quote.coupon.code} applied</p>}
            {quote?.couponInvalid && <p class="s-err">That code isn’t valid.</p>}
          </form>
        </div>
        {!!quote?.conflicts.length && <div class="mt-4">{altDates}</div>}
        {Err({ k: 'cart' })}
        {Nav({ s: 1, label: 'Continue to setup →', disabled: !lines.length })}
      </section>
    );
  } else if (step === 2) {
    body = (
      <section>
        <h2 class="s-h2 !text-2xl sm:!text-3xl">Where should we set up?</h2>
        <p class="s-sub mt-1">A few details help the crew arrive with the right stakes, sandbags and cords.</p>
        <div class="mt-5 grid grid-cols-6 gap-3">
          <div class="col-span-6">
            <label class="s-label" for="co-address">Street address</label>
            <input id="co-address" class="s-input" autoComplete="street-address" value={f.address} onInput={set('address')} {...inv('address')} />
            {Err({ k: 'address' })}
          </div>
          <div class="col-span-3 sm:col-span-3">
            <label class="s-label" for="co-city">City</label>
            <input id="co-city" class="s-input" autoComplete="address-level2" value={f.city} onInput={set('city')} {...inv('city')} />
            {Err({ k: 'city' })}
          </div>
          <div class="col-span-1 sm:col-span-1">
            <label class="s-label" for="co-state">State</label>
            <input id="co-state" class="s-input" autoComplete="address-level1" maxLength={2} value={f.state} onInput={set('state')} />
          </div>
          <div class="col-span-2">
            <label class="s-label" for="co-zip2">ZIP</label>
            <input id="co-zip2" class="s-input" value={zip} readOnly aria-describedby="zip-note" />
          </div>
          <p id="zip-note" class="col-span-6 s-hint -mt-1">ZIP comes from your event step — <button type="button" class="underline font-bold" onClick={() => go(0)}>change it</button> to re-check delivery.</p>
          <div class="col-span-6 sm:col-span-3">
            <label class="s-label" for="co-venue">Venue</label>
            <select id="co-venue" class="s-input" value={f.venue} onChange={set('venue')}>{VENUES.map(([v, l]) => <option value={v}>{l}</option>)}</select>
          </div>
          <div class="col-span-6 sm:col-span-3">
            <label class="s-label" for="co-type">Type of event</label>
            <select id="co-type" class="s-input" value={f.eventType} onChange={set('eventType')}>{EVENT_TYPES.map(([v, l]) => <option value={v}>{l}</option>)}</select>
          </div>
          {(f.venue === 'park' || f.venue === 'school' || f.venue === 'church') && (
            <p class="col-span-6 rounded-xl bg-soft p-3 text-sm font-semibold">Heads up: {f.venue === 'park' ? 'most parks need a permit and a generator. ' : ''}We’ll email a certificate of insurance (COI) for your venue — just ask.</p>
          )}
          <fieldset class="col-span-6">
            <legend class="s-label">Setup surface</legend>
            <div class="grid sm:grid-cols-3 gap-2">
              {p.surfaces.map((s) => (
                <label class={`flex items-center gap-2 rounded-xl border-2 px-3 min-h-12 cursor-pointer ${surface === s.key ? 'border-[var(--c-primary)] bg-soft' : 'border-line bg-white'}`}>
                  <input type="radio" name="surface" value={s.key} checked={surface === s.key} onChange={() => setSurface(s.key)} class="accent-[var(--c-primary)]" />
                  <span class="text-sm font-bold flex-1">{s.label}</span>
                  {s.feeCents > 0 && <span class="text-xs s-price">+{money(s.feeCents)}</span>}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset class="col-span-6 sm:col-span-3">
            <legend class="s-label">Standard outlet within 50 ft?</legend>
            <div class="flex gap-2">
              {(['yes', 'no', 'unsure'] as const).map((v) => (
                <label class={`flex-1 flex items-center justify-center gap-2 rounded-xl border-2 min-h-12 cursor-pointer text-sm font-bold ${f.power === v ? 'border-[var(--c-primary)] bg-soft' : 'border-line bg-white'}`}>
                  <input type="radio" name="power" class="sr-only" checked={f.power === v} onChange={() => setF((x) => ({ ...x, power: v }))} />{v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Not sure'}
                </label>
              ))}
            </div>
            {f.power === 'no' && <p class="s-hint">No problem — add a generator from your cart (we’ve suggested one).</p>}
          </fieldset>
          {hasWet && (
            <fieldset class="col-span-6 sm:col-span-3">
              <legend class="s-label">Garden hose within 50 ft?</legend>
              <div class="flex gap-2">
                {(['yes', 'no'] as const).map((v) => (
                  <label class={`flex-1 flex items-center justify-center rounded-xl border-2 min-h-12 cursor-pointer text-sm font-bold ${f.water === v ? 'border-[var(--c-primary)] bg-soft' : 'border-line bg-white'}`}>
                    <input type="radio" name="water" class="sr-only" checked={f.water === v} onChange={() => setF((x) => ({ ...x, water: v }))} />{v === 'yes' ? 'Yes' : 'No'}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div class="col-span-6">
            <label class="s-label" for="co-notes">Anything the crew should know? <span class="font-normal s-sub">(optional)</span></label>
            <textarea id="co-notes" class="s-input" rows={3} placeholder="Gate width, pets, sprinkler heads, steep driveway, setup spot…" value={f.notes} onInput={set('notes')} />
          </div>
        </div>
        {Nav({ s: 2, label: 'Continue →' })}
      </section>
    );
  } else if (step === 3) {
    body = (
      <section>
        <h2 class="s-h2 !text-2xl sm:!text-3xl">Who’s the party host?</h2>
        <p class="s-sub mt-1">No account needed. We’ll text you when the crew is on the way.</p>
        <div class="mt-5 grid sm:grid-cols-2 gap-3">
          <div class="sm:col-span-2">
            <label class="s-label" for="co-name">Full name</label>
            <input id="co-name" class="s-input" autoComplete="name" value={f.name} onInput={set('name')} {...inv('name')} />
            {Err({ k: 'name' })}
          </div>
          <div>
            <label class="s-label" for="co-phone">Mobile phone</label>
            <input id="co-phone" class="s-input" type="tel" autoComplete="tel" inputMode="tel" value={f.phone} onInput={set('phone')} {...inv('phone')} />
            {Err({ k: 'phone' })}
          </div>
          <div>
            <label class="s-label" for="co-email">Email</label>
            <input id="co-email" class="s-input" type="email" autoComplete="email" value={f.email} onInput={set('email')} {...inv('email')} />
            {Err({ k: 'email' })}
          </div>
          <div>
            <label class="s-label" for="co-cel">Birthday star’s name <span class="font-normal s-sub">(optional)</span></label>
            <input id="co-cel" class="s-input" value={f.celebrantName} onInput={set('celebrantName')} />
          </div>
          <div>
            <label class="s-label" for="co-bday">Their birthday <span class="font-normal s-sub">(optional)</span></label>
            <input id="co-bday" class="s-input" type="date" value={f.celebrantBirthday} onInput={set('celebrantBirthday')} />
          </div>
          <label class="sm:col-span-2 flex gap-3 items-start text-sm cursor-pointer min-h-11">
            <input type="checkbox" class="mt-0.5 size-5 accent-[var(--c-primary)]" checked={f.smsOptIn} onChange={set('smsOptIn')} />
            <span>Text me booking updates and the crew’s arrival window. Msg & data rates may apply; reply STOP to opt out.</span>
          </label>
          <label class="sm:col-span-2 flex gap-3 items-start text-sm cursor-pointer min-h-11">
            <input type="checkbox" class="mt-0.5 size-5 accent-[var(--c-primary)]" checked={f.marketingOptIn} onChange={set('marketingOptIn')} />
            <span>Send me birthday reminders and occasional deals from {p.tenantName}.</span>
          </label>
        </div>
        {Nav({ s: 3, label: 'Continue to agreement →' })}
      </section>
    );
  } else if (step === 4) {
    body = (
      <section>
        <h2 class="s-h2 !text-2xl sm:!text-3xl">Review & sign the rental agreement</h2>
        <p class="s-sub mt-1">Quick read — it covers safety, weather and cancellations.</p>
        <div class="mt-5 s-card p-5 max-h-80 overflow-auto s-prose !text-[0.95rem]" tabIndex={0} aria-label="Rental agreement" dangerouslySetInnerHTML={{ __html: p.agreementHtml }} />
        <div class="mt-4 grid gap-3">
          <div>
            <label class="s-label" for="co-sign">Type your full name to sign</label>
            <input id="co-sign" class="s-input font-[cursive] text-xl" autoComplete="name" value={f.signName || ''} placeholder={f.name} onInput={set('signName')} {...inv('signName')} />
            {Err({ k: 'signName' })}
          </div>
          <label class="flex gap-3 items-start cursor-pointer min-h-11">
            <input type="checkbox" class="mt-0.5 size-5 accent-[var(--c-primary)]" checked={f.accepted} onChange={set('accepted')} {...inv('accepted')} />
            <span class="text-sm font-semibold">I’m 18+ and agree to the rental agreement, safety rules and the cancellation & weather policy. Typing my name is my electronic signature.</span>
          </label>
          {Err({ k: 'accepted' })}
        </div>
        {Nav({ s: 4, label: 'Continue to payment →' })}
      </section>
    );
  } else {
    body = (
      <section>
        <h2 class="s-h2 !text-2xl sm:!text-3xl">Lock in your date</h2>
        <p class="s-sub mt-1">Pay your deposit now — your booking is confirmed instantly. The balance is due on delivery.</p>
        <div class="mt-5 s-card p-5 grid gap-2">
          <p class="font-extrabold text-lg">{prettyDay(day, true)} · {hourLabel(start)}–{hourLabel(endFixed)}</p>
          <p class="text-sm s-sub">{f.address}, {f.city} {f.state} {zip}</p>
          <p class="text-sm s-sub">{f.name} · {f.phone} · {f.email}</p>
          <p class="text-sm">Signed by <span class="font-[cursive] text-lg">{f.signName}</span></p>
          {quote && <div class="mt-2 rounded-xl bg-soft p-4 grid gap-1"><Row label="Due today" cents={quote.depositCents} strong /><Row label={`Balance on delivery`} cents={quote.balanceCents} /></div>}
        </div>
        <p class="mt-4 text-sm font-semibold flex gap-2 items-start"><span aria-hidden="true">⏱</span> We hold your items for {p.holdMinutes} minutes while you pay. Secure checkout — we never see your card number.</p>
        {Nav({ s: 5, label: busy ? 'Starting secure checkout…' : quote ? `Pay ${money(quote.depositCents)} deposit` : 'Pay deposit', disabled: busy || !quote, onNext: book })}
      </section>
    );
  }

  return (
    <div ref={topRef} class="grid lg:grid-cols-[1fr_380px] gap-6 lg:gap-10 items-start scroll-mt-24">
      <div class="min-w-0">
        {stepHeader}
        {banner && <div role="alert" class="mb-5 rounded-2xl border-2 border-[var(--color-bad)] bg-white p-4 font-bold">{banner}</div>}
        {!ready ? <p class="s-sub">Loading your cart…</p> : <div key={step}>{body}</div>}
      </div>
      {summary}
    </div>
  );
}
