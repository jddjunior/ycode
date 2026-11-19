/**
 * Date + time + ZIP availability checker.
 *  mode "search": hero / CTA band. Live count of open rentals + delivery fee, submits to /rentals (works without JS).
 *  mode "item":   product buy box. Available / last one / booked for the date, delivery fee, add-ons, "Reserve for {date}".
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { HOURS, addLines, nearbyOpenDates, fetchAvailability, hourLabel, loadCart, money, prettyDay, saveCart, zoneText, type AvailResponse } from './store';

interface Addon { id: string; name: string; priceCents: number; image: string }
interface Props {
  mode: 'search' | 'item';
  slug: string; api: string; base: string;
  minDay: string; maxDay: string;
  defaultStart: number; defaultEnd: number;
  phone?: string;
  idPrefix?: string;
  submitLabel?: string;
  layout?: 'bar' | 'stack';
  initial?: { day?: string; startHour?: number; endHour?: number; zip?: string };
  item?: { id: string; name: string; priceCents: number; baseHours: number; extraHourCents: number; quantity: number };
  addons?: Addon[];
  depositText?: string;
  similar?: { id: string; name: string; href: string; priceCents: number; image: string }[];
  contactHref?: string;
}

export default function AvailabilityChecker(p: Props) {
  const id = p.idPrefix ?? p.mode;
  const [day, setDay] = useState(p.initial?.day ?? '');
  const [start, setStart] = useState(p.initial?.startHour ?? p.defaultStart);
  const [end, setEnd] = useState(p.initial?.endHour ?? p.defaultEnd);
  const [zip, setZip] = useState(p.initial?.zip ?? '');
  const [res, setRes] = useState<AvailResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [needDate, setNeedDate] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (p.initial?.day) return;
    const c = loadCart(p.slug);
    if (c.day && c.day >= p.minDay) setDay(c.day);
    if (c.startHour != null) setStart(c.startHour);
    if (c.endHour != null) setEnd(c.endHour);
    if (c.zip) setZip(c.zip);
  }, []);

  const endFixed = end > start ? end : Math.min(24, start + 4);
  useEffect(() => {
    if (!day) { setRes(null); return; }
    const n = ++seq.current;
    setLoading(true); setErr(null);
    const h = setTimeout(async () => {
      const r = await fetchAvailability(p.api, day, start, endFixed, zip);
      if (n !== seq.current) return;
      setLoading(false);
      if ('error' in r) { setErr(r.error); setRes(null); } else setRes(r);
    }, 250);
    const c = loadCart(p.slug);
    saveCart(p.slug, { ...c, day, startHour: start, endHour: endFixed, zip: /^\d{5}$/.test(zip) ? zip : c.zip });
    return () => clearTimeout(h);
  }, [day, start, endFixed, zip]);

  const [alts, setAlts] = useState<string[] | null>(null);
  useEffect(() => {
    setAlts(null);
    if (!res || !day) return;
    const blockedDay = !res.ok || (p.item && (res.items.find((i) => i.id === p.item!.id)?.free ?? 0) === 0);
    if (!blockedDay) return;
    let live = true;
    nearbyOpenDates(p.api, day, start, endFixed, p.minDay, p.maxDay, p.item ? [p.item.id] : []).then((d) => { if (live) setAlts(d); });
    return () => { live = false; };
  }, [res]);
  const altBlock = alts !== null && (
    <div class="rounded-2xl bg-soft p-3 grid gap-2">
      {alts.length > 0 ? (
        <>
          <p class="text-sm font-extrabold">{p.item ? `${p.item.name} is open on:` : 'Open nearby dates:'}</p>
          <div class="flex flex-wrap gap-2">{alts.map((d) => <button type="button" class="s-filter !min-h-11 !text-sm" onClick={() => setDay(d)}>{prettyDay(d)}</button>)}</div>
        </>
      ) : <p class="text-sm font-bold">No nearby openings online — text us, we often have options.</p>}
      {p.similar && res?.ok && (() => {
        const free = p.similar.filter((x) => (res.items.find((i) => i.id === x.id)?.free ?? 0) > 0).slice(0, 3);
        return free.length ? (
          <div class="grid gap-1.5">
            <p class="text-sm font-extrabold mt-1">Similar rentals free {prettyDay(day)}:</p>
            {free.map((x) => <a href={x.href} class="flex items-center gap-2 rounded-xl bg-white p-1.5 pr-3 min-h-11 hover:underline"><img src={x.image} alt="" width={44} height={33} class="w-11 h-[33px] rounded-md object-cover" /><span class="flex-1 text-sm font-bold">{x.name}</span><span class="s-price text-sm">{money(x.priceCents)}</span></a>)}
          </div>
        ) : null;
      })()}
      {p.contactHref && <a href={p.contactHref} class="text-sm font-bold underline underline-offset-2">Join the waitlist or request a custom quote →</a>}
    </div>
  );
  const zt = res && /^\d{5}$/.test(zip) ? zoneText(res.zone, zip) : null;
  const free = useMemo(() => (p.item && res ? res.items.find((i) => i.id === p.item!.id)?.free ?? 0 : null), [res]);
  const hours = endFixed - start;
  const unit = p.item ? p.item.priceCents + Math.max(0, Math.ceil(hours - p.item.baseHours)) * p.item.extraHourCents : 0;

  const dateField = (
      <div class="bos-f bos-f-date">
        <label class="s-label" for={`${id}-date`}>Event date</label>
        <input ref={dateRef} id={`${id}-date`} name="date" type="date" class="s-input" required min={p.minDay} max={p.maxDay} value={day}
          aria-invalid={needDate ? 'true' : undefined}
          onInput={(e) => { setDay((e.target as HTMLInputElement).value); setNeedDate(false); }} />
      </div>
  );
  const startField = (
      <div class="bos-f bos-f-time">
        <label class="s-label" for={`${id}-start`}>Start</label>
        <select id={`${id}-start`} name="start" class="s-input" value={String(start)} onChange={(e) => setStart(+(e.target as HTMLSelectElement).value)}>
          {HOURS.slice(0, -2).map((h) => <option value={h} selected={h === start}>{hourLabel(h)}</option>)}
        </select>
      </div>
  );
  const endField = (
      <div class="bos-f bos-f-time">
        <label class="s-label" for={`${id}-end`}>End</label>
        <select id={`${id}-end`} name="end" class="s-input" value={String(endFixed)} onChange={(e) => setEnd(+(e.target as HTMLSelectElement).value)}>
          {HOURS.filter((h) => h > start).map((h) => <option value={h} selected={h === endFixed}>{hourLabel(h)}</option>)}
        </select>
      </div>
  );
  const zipField = (
      <div class="bos-f bos-f-zip">
        <label class="s-label" for={`${id}-zip`}>Delivery ZIP</label>
        <input id={`${id}-zip`} name="zip" class="s-input" inputMode="numeric" autoComplete="postal-code" pattern="\d{5}" maxLength={5} placeholder="e.g. 77008" value={zip}
          onInput={(e) => setZip((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 5))} />
      </div>
  );

  const status = (
    <div class="bos-status" aria-live="polite">
      {loading && <p class="s-sub text-sm font-semibold">Checking {day ? prettyDay(day) : ''}…</p>}
      {!loading && err && <p class="s-err">{err}</p>}
      {!loading && res && !res.ok && <p class="s-chip s-chip-warn whitespace-normal">{res.message}</p>}
      {!loading && res && res.ok && p.mode === 'search' && (
        <p class="flex flex-wrap items-center gap-2 text-sm font-bold">
          <span class="s-chip s-chip-ok">● {res.available} rentals open {prettyDay(day)}</span>
          {zt && <span class={`s-chip ${zt.tone === 'ok' ? '' : 's-chip-bad'} whitespace-normal`}>{zt.text}</span>}
        </p>
      )}
      {!loading && res && !res.ok && altBlock}
    </div>
  );

  if (p.mode === 'search') {
    const bar = p.layout !== 'stack';
    return (
      <form method="get" action={`${p.base}/rentals`} class="bos-search" onSubmit={() => {
        const c = loadCart(p.slug);
        saveCart(p.slug, { ...c, day, startHour: start, endHour: endFixed, zip });
      }}>
        <div class={bar ? 'grid gap-3 grid-cols-2 sm:grid-cols-4 items-end' : 'grid gap-3 grid-cols-2'}>
          <div class="col-span-2">{dateField}</div>
          <div class="col-span-2">{zipField}</div>
          {startField}
          {endField}
          <button type="submit" class="s-btn s-btn-cta s-btn-lg w-full col-span-2">{p.submitLabel ?? 'See what’s available'}</button>
        </div>
        <div class="mt-2.5">{status}</div>
      </form>
    );
  }

  // ── item mode
  const it = p.item!;
  const addonTotal = (p.addons ?? []).filter((a) => picked[a.id]).reduce((s, a) => s + a.priceCents, 0);
  const booked = res?.ok && free === 0;
  const blocked = !!res && (!res.ok || booked || (zt?.tone === 'bad'));
  const reserve = () => {
    if (!day) { setNeedDate(true); dateRef.current?.focus(); return; }
    if (blocked) return;
    let c = loadCart(p.slug);
    c = addLines({ ...c, day, startHour: start, endHour: endFixed, zip: /^\d{5}$/.test(zip) ? zip : c.zip }, [{ itemId: it.id, qty: 1 }, ...(p.addons ?? []).filter((a) => picked[a.id]).map((a) => ({ itemId: a.id, qty: 1 }))]);
    saveCart(p.slug, c);
    location.href = `${p.base}/book`;
  };
  return (
    <div class="bos-buy grid gap-4">
      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2">{dateField}</div>
        {startField}
        {endField}
        <div class="col-span-2">{zipField}</div>
      </div>
      <div aria-live="polite" class="grid gap-2 min-h-6">
        {loading && <p class="s-sub text-sm font-semibold">Checking {prettyDay(day)}…</p>}
        {!loading && err && <p class="s-err">{err}</p>}
        {!loading && res && !res.ok && <p class="s-chip s-chip-warn whitespace-normal">{res.message}</p>}
        {!loading && res?.ok && free != null && (
          free === 0 ? <p class="s-chip s-chip-bad">Booked for {prettyDay(day)} — try another time or see similar rentals below</p>
            : free === 1 ? <p class="s-chip s-chip-warn">🔥 Last one available for {prettyDay(day)}</p>
              : <p class="s-chip s-chip-ok">✓ Available {prettyDay(day)} · {free} left</p>
        )}
        {!loading && zt && <p class={`s-chip ${zt.tone === 'ok' ? '' : 's-chip-bad'} whitespace-normal`}>{zt.text}</p>}
        {!loading && altBlock}
        {!day && <p class="s-hint">Pick your date to see live availability for {it.name}.</p>}
      </div>
      {!!p.addons?.length && (
        <fieldset class="grid gap-2">
          <legend class="s-label">Popular add-ons</legend>
          {p.addons.map((a) => {
            const af = res?.ok ? res.items.find((x) => x.id === a.id)?.free : undefined;
            const out = af === 0;
            return (
              <label class={`flex items-center gap-3 rounded-xl border-2 p-2 pr-3 cursor-pointer min-h-12 ${picked[a.id] ? 'border-[var(--c-primary)] bg-soft' : 'border-line bg-white'} ${out ? 'opacity-50' : ''}`}>
                <input type="checkbox" class="size-5 accent-[var(--c-primary)]" checked={!!picked[a.id]} disabled={out}
                  onChange={(e) => setPicked({ ...picked, [a.id]: (e.target as HTMLInputElement).checked })} />
                <img src={a.image} alt="" width={44} height={33} loading="lazy" class="rounded-md object-cover w-11 h-[33px]" />
                <span class="flex-1 text-sm font-bold leading-tight">{a.name}{out && <span class="block text-xs font-semibold">Booked that day</span>}</span>
                <span class="s-price text-sm">+{money(a.priceCents)}</span>
              </label>
            );
          })}
        </fieldset>
      )}
      <div class="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span class="text-sm font-bold">{hours}-hour rental{addonTotal ? ' + add-ons' : ''}</span>
        <span class="s-price text-2xl">{money(unit + addonTotal)}</span>
      </div>
      <button type="button" class="s-btn s-btn-cta s-btn-lg w-full" onClick={reserve} aria-disabled={blocked ? 'true' : undefined}>
        {day ? (booked ? 'Booked that day' : `Reserve for ${prettyDay(day)}`) : 'Check availability'}
      </button>
      {p.depositText && <p class="text-center text-sm font-semibold s-sub">{p.depositText} · balance due on delivery</p>}
      {p.phone && (
        <div class="grid grid-cols-2 gap-2">
          <a class="s-btn s-btn-ghost s-btn-sm" href={`sms:${p.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(`Hi! Is the ${it.name} available${day ? ' on ' + prettyDay(day) : ''}?`)}`}>Text us</a>
          <a class="s-btn s-btn-ghost s-btn-sm" href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}>Call</a>
        </div>
      )}
    </div>
  );
}
