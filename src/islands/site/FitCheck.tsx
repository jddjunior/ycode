/** "Will it fit?" helper: compare the shopper's measured space to the unit's setup area. */
import { useState } from 'preact/hooks';

interface Props { name: string; needW: number; needL: number; heightFt?: number; surfaces: string[] }

export default function FitCheck(p: Props) {
  const [w, setW] = useState('');
  const [l, setL] = useState('');
  const [surface, setSurface] = useState('grass');
  const W = parseFloat(w), L = parseFloat(l);
  const has = Number.isFinite(W) && Number.isFinite(L) && W > 0 && L > 0;
  const [a, b] = [Math.max(W, L), Math.min(W, L)];
  const [na, nb] = [Math.max(p.needW, p.needL), Math.min(p.needW, p.needL)];
  const fits = has && a >= na && b >= nb;
  const tight = has && fits && (a - na < 2 || b - nb < 2);
  const surfOk = p.surfaces.length === 0 || p.surfaces.includes(surface);
  return (
    <div class="grid gap-3">
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label class="s-label" for="fit-w">Your space width (ft)</label>
          <input id="fit-w" class="s-input" inputMode="decimal" value={w} onInput={(e) => setW((e.target as HTMLInputElement).value)} placeholder="e.g. 22" />
        </div>
        <div>
          <label class="s-label" for="fit-l">Length (ft)</label>
          <input id="fit-l" class="s-input" inputMode="decimal" value={l} onInput={(e) => setL((e.target as HTMLInputElement).value)} placeholder="e.g. 30" />
        </div>
        <div class="col-span-2 sm:col-span-1">
          <label class="s-label" for="fit-s">Surface</label>
          <select id="fit-s" class="s-input" value={surface} onChange={(e) => setSurface((e.target as HTMLSelectElement).value)}>
            <option value="grass">Grass</option><option value="concrete">Concrete / driveway</option><option value="asphalt">Asphalt</option><option value="indoor">Indoor / gym</option>
          </select>
        </div>
      </div>
      <div aria-live="polite" class="grid gap-2">
        {has && (fits
          ? <p class={`s-chip ${tight ? 's-chip-warn' : 's-chip-ok'} whitespace-normal`}>{tight ? `It fits, but it’s snug — keep ${p.needW} × ${p.needL} ft completely clear (no fences, trees or overhead lines).` : `✓ ${p.name} fits with room to spare.`}</p>
          : <p class="s-chip s-chip-bad whitespace-normal">Too tight — {p.name} needs about {p.needW} × {p.needL} ft. Text us a photo and we’ll suggest a smaller unit.</p>)}
        {!surfOk && <p class="s-chip s-chip-warn whitespace-normal">This unit isn’t rated for {surface} setups. Choose a unit marked for {surface}, or call us.</p>}
        {surfOk && surface !== 'grass' && <p class="s-hint">On hard surfaces we anchor with sandbags instead of stakes (small surface fee at checkout).</p>}
        {p.heightFt ? <p class="s-hint">Needs about {p.heightFt + 2} ft of overhead clearance — check for branches and power lines.</p> : null}
      </div>
    </div>
  );
}
