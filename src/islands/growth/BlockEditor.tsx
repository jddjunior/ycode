/** @jsxImportSource preact */
import { useState } from 'preact/hooks';
import { BLOCK_DEFS, defFor, LIMITS, TRUST_ICONS, type FieldDef } from '../../lib/growth/blockdefs';

interface Block { id: string; type: string; props: Record<string, unknown> }
interface Props { pageId: string; initial: Block[]; previewUrl: string }

const rid = () => Math.random().toString(36).slice(2, 10);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function Field({ f, value, onChange, idPrefix }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; idPrefix: string }) {
  const id = `${idPrefix}-${f.key}`;
  const count = typeof value === 'string' && f.max ? <span class={`ml-2 font-normal ${value.length > f.max ? 'text-danger' : 'text-ink-2'}`}>{value.length}/{f.max}</span> : null;
  if (f.kind === 'bool') {
    return (
      <label class="flex items-center gap-2 text-sm font-medium" for={id}>
        <input id={id} type="checkbox" class="size-4 accent-[var(--color-brand)]" checked={!!value} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
        {f.label}
      </label>
    );
  }
  if (f.kind === 'repeater') {
    const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    const set = (i: number, k: string, v: unknown) => { const n = clone(rows); n[i] = { ...n[i], [k]: v }; onChange(n); };
    const move = (i: number, d: number) => { const n = clone(rows); const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
    return (
      <fieldset class="space-y-3">
        <legend class="label">{f.label} <span class="font-normal text-ink-2">({rows.length}/{f.max ?? LIMITS.listItems})</span></legend>
        {rows.map((row, i) => (
          <div class="rounded-xl border border-line bg-canvas/60 p-3 space-y-2" key={i}>
            <div class="flex items-center gap-1 text-xs font-semibold text-ink-2">
              <span>#{i + 1}</span>
              <span class="ml-auto flex gap-1">
                <button type="button" class="px-2 py-1 rounded hover:bg-white" aria-label={`Move item ${i + 1} up`} onClick={() => move(i, -1)}>↑</button>
                <button type="button" class="px-2 py-1 rounded hover:bg-white" aria-label={`Move item ${i + 1} down`} onClick={() => move(i, 1)}>↓</button>
                <button type="button" class="px-2 py-1 rounded hover:bg-white text-danger" aria-label={`Remove item ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button>
              </span>
            </div>
            {(f.fields ?? []).map((sf) => <Field key={sf.key} f={sf} value={row[sf.key]} idPrefix={`${id}-${i}`} onChange={(v) => set(i, sf.key, v)} />)}
          </div>
        ))}
        {rows.length < (f.max ?? LIMITS.listItems) && (
          <button type="button" class="btn-ghost min-h-9 text-xs" onClick={() => onChange([...rows, Object.fromEntries((f.fields ?? []).map((sf) => [sf.key, sf.options ? sf.options[0] : '']))])}>+ Add {f.label.toLowerCase().replace(/s$/, '')}</button>
        )}
      </fieldset>
    );
  }
  if (f.kind === 'lines') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        <label class="label" for={id}>{f.label}</label>
        <textarea id={id} class="input" rows={3} value={arr.join('\n')} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value.split('\n').map((s) => s.trimStart()).filter((s, i, a) => s || i === a.length - 1).slice(0, f.max ?? LIMITS.listItems))} />
        {f.hint && <p class="hint">{f.hint}</p>}
      </div>
    );
  }
  if (f.kind === 'number') {
    return (
      <div>
        <label class="label" for={id}>{f.label}</label>
        <input id={id} type="number" class="input max-w-32" min={f.min} max={f.max} value={Number(value ?? f.min ?? 0)} onInput={(e) => onChange(Math.max(f.min ?? 0, Math.min(f.max ?? 100, Number.parseInt((e.target as HTMLInputElement).value || '0', 10))))} />
      </div>
    );
  }
  if (f.options) {
    return (
      <div>
        <label class="label" for={id}>{f.label}</label>
        <select id={id} class="input" value={String(value ?? f.options[0])} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
          {(f.options === TRUST_ICONS ? TRUST_ICONS : f.options).map((o) => <option value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  const common = { id, class: 'input', value: String(value ?? ''), maxLength: f.max, onInput: (e: Event) => onChange((e.target as HTMLInputElement).value) };
  return (
    <div>
      <label class="label" for={id}>{f.label}{count}</label>
      {f.kind === 'textarea' ? <textarea rows={f.key === 'markdown' ? 10 : 3} {...common} /> : <input type="text" inputMode={f.kind === 'image' ? 'url' : 'text'} {...common} />}
      {f.hint && <p class="hint">{f.hint}</p>}
      {f.kind === 'image' && typeof value === 'string' && value && <img src={value} alt="" class="mt-2 h-20 rounded-lg border border-line object-cover bg-white" loading="lazy" />}
    </div>
  );
}

export default function BlockEditor({ pageId, initial, previewUrl }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => clone(initial));
  const [open, setOpen] = useState<string | null>(initial[0]?.id ?? null);
  const [addType, setAddType] = useState(BLOCK_DEFS[0].type);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'ok' | 'error'; msg?: string }>({ kind: 'idle' });
  const [dirty, setDirty] = useState(false);

  const update = (next: Block[]) => { setBlocks(next); setDirty(true); setStatus({ kind: 'idle' }); };
  const move = (i: number, d: number) => { const n = [...blocks]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; update(n); };
  const remove = (i: number) => { if (confirm(`Remove the ${defFor(blocks[i].type)?.label ?? blocks[i].type} block?`)) update(blocks.filter((_, j) => j !== i)); };
  const add = () => {
    const d = defFor(addType); if (!d) return;
    if (blocks.length >= LIMITS.blocks) { setStatus({ kind: 'error', msg: `At most ${LIMITS.blocks} blocks.` }); return; }
    const b = { id: rid(), type: d.type, props: clone(d.defaults) };
    update([...blocks, b]); setOpen(b.id);
  };
  const setProp = (i: number, k: string, v: unknown) => { const n = [...blocks]; n[i] = { ...n[i], props: { ...n[i].props, [k]: v } }; update(n); };

  async function save() {
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/app/website/blocks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, blocks }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setStatus({ kind: 'error', msg: j.error ?? `Save failed (${res.status})` }); return; }
      setBlocks(j.blocks); setDirty(false); setStatus({ kind: 'ok', msg: 'Saved. Your live site is updated.' });
    } catch { setStatus({ kind: 'error', msg: 'Network error — try again.' }); }
  }

  return (
    <div class="space-y-3">
      <div class="card p-3 flex flex-wrap items-center gap-2 sticky top-[4.5rem] z-20">
        <label class="sr-only" for="add-type">Block type</label>
        <select id="add-type" class="input w-auto min-w-0 flex-1 sm:flex-none" value={addType} onChange={(e) => setAddType((e.target as HTMLSelectElement).value)}>
          {BLOCK_DEFS.map((d) => <option value={d.type}>{d.label}</option>)}
        </select>
        <button type="button" class="btn-ghost" onClick={add}>+ Add block</button>
        <div class="ml-auto flex items-center gap-2">
          <a class="btn-ghost" href={previewUrl} target="_blank" rel="noopener">Preview</a>
          <button type="button" class="btn-primary" disabled={status.kind === 'saving' || !dirty} onClick={save}>{status.kind === 'saving' ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
        </div>
        {status.msg && <p role="status" class={`w-full text-sm font-medium ${status.kind === 'error' ? 'text-danger' : 'text-mint'}`}>{status.msg}</p>}
      </div>

      {blocks.length === 0 && <div class="card p-8 text-center text-ink-2 text-sm">No blocks yet. Add a Hero first, then the sections you need.</div>}

      <ol class="space-y-3">
        {blocks.map((b, i) => {
          const d = defFor(b.type);
          const isOpen = open === b.id;
          const summary = String(b.props.headline ?? b.props.title ?? (typeof b.props.markdown === 'string' ? b.props.markdown.slice(0, 60) : '') ?? '');
          return (
            <li class="card overflow-hidden" key={b.id}>
              <div class="flex items-center gap-2 p-3">
                <span class="grid place-items-center size-7 rounded-lg bg-brand-soft text-brand text-xs font-bold shrink-0">{i + 1}</span>
                <button type="button" class="min-w-0 flex-1 text-left cursor-pointer" aria-expanded={isOpen} aria-controls={`blk-${b.id}`} onClick={() => setOpen(isOpen ? null : b.id)}>
                  <span class="block text-sm font-semibold">{d?.label ?? b.type}</span>
                  <span class="block text-xs text-ink-2 truncate">{summary || d?.description}</span>
                </button>
                <div class="flex items-center gap-0.5 shrink-0">
                  <button type="button" class="size-9 rounded-lg hover:bg-canvas disabled:opacity-30" disabled={i === 0} aria-label={`Move ${d?.label} up`} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" class="size-9 rounded-lg hover:bg-canvas disabled:opacity-30" disabled={i === blocks.length - 1} aria-label={`Move ${d?.label} down`} onClick={() => move(i, 1)}>↓</button>
                  <button type="button" class="size-9 rounded-lg hover:bg-red-50 text-danger" aria-label={`Remove ${d?.label}`} onClick={() => remove(i)}>✕</button>
                </div>
              </div>
              {isOpen && (
                <div id={`blk-${b.id}`} class="border-t border-line p-4 space-y-4">
                  {d && d.fields.length === 0 && <p class="text-sm text-ink-2">{d.description}</p>}
                  {d?.fields.map((f) => <Field key={f.key} f={f} value={b.props[f.key]} idPrefix={b.id} onChange={(v) => setProp(i, f.key, v)} />)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
