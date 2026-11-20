/** Inventory form parsing (shared by /app/inventory/new and /app/inventory/[id]). */
import { z } from 'zod';
import type { ItemSpecs } from '../../db/schema';
import { str, int, cents, bool, list } from '../forms';
import { slugify } from '../util';

export type OpsSpecs = ItemSpecs & { purchaseCostCents?: number };

const optNum = (f: FormData, k: string) => { const v = String(f.get(k) ?? '').trim(); if (!v) return undefined; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
const optCents = (f: FormData, k: string) => (String(f.get(k) ?? '').trim() ? cents(f, k) : null);

export const ItemSchema = z.object({
  name: z.string().min(2, 'Name is required').max(120),
  slug: z.string().regex(/^[a-z0-9-]{2,80}$/, 'Slug can only use a–z, 0–9 and dashes'),
  kind: z.enum(['rental', 'addon', 'package']),
  priceCents: z.number().int().min(0).max(10_000_000),
  quantity: z.number().int().min(0).max(999),
  baseHours: z.number().int().min(1).max(72),
  setupMinutes: z.number().int().min(0).max(600),
  teardownMinutes: z.number().int().min(0).max(600),
  images: z.array(z.string().regex(/^(https:\/\/|\/)[^\s"'<>]+$/, 'Images must be https:// or /path URLs')).max(12),
});

export function readItemForm(f: FormData, validIds: Set<string>) {
  const name = str(f, 'name', 120);
  const kind = (['rental', 'addon', 'package'] as const).find((k) => k === str(f, 'kind', 10)) ?? 'rental';
  const bundle: { itemId: string; qty: number }[] = [];
  if (kind === 'package') {
    for (const [k, v] of f.entries()) {
      if (!k.startsWith('bundle_')) continue;
      const id = k.slice(7), qty = Number.parseInt(String(v), 10);
      if (validIds.has(id) && qty > 0) bundle.push({ itemId: id, qty: Math.min(qty, 20) });
    }
  }
  const specs: OpsSpecs = {
    lengthFt: optNum(f, 'lengthFt'), widthFt: optNum(f, 'widthFt'), heightFt: optNum(f, 'heightFt'),
    setupAreaFt: str(f, 'setupAreaFt', 30) || undefined, ageRange: str(f, 'ageRange', 30) || undefined,
    maxRiders: optNum(f, 'maxRiders'), maxWeightLbs: optNum(f, 'maxWeightLbs'), outlets: optNum(f, 'outlets'), blowers: optNum(f, 'blowers'),
    surfaces: f.getAll('specSurfaces').map(String).filter((s) => /^[a-z_-]{2,30}$/.test(s)),
    material: str(f, 'material', 60) || undefined, theme: str(f, 'theme', 60) || undefined,
    purchaseCostCents: optCents(f, 'purchaseCost') ?? undefined,
  };
  for (const k of Object.keys(specs) as (keyof OpsSpecs)[]) if (specs[k] === undefined || (Array.isArray(specs[k]) && !(specs[k] as unknown[]).length)) delete specs[k];
  const categoryId = str(f, 'categoryId', 40);
  const values = {
    name, slug: slugify(str(f, 'slug', 80) || name, 80), kind,
    categoryId: validIds.has('cat:' + categoryId) ? categoryId : null,
    tagline: str(f, 'tagline', 200), description: str(f, 'description', 5000),
    images: list(f, 'images').slice(0, 12),
    priceCents: cents(f, 'price'), baseHours: int(f, 'baseHours', 8), extraHourCents: cents(f, 'extraHour'), overnightCents: optCents(f, 'overnight'),
    quantity: int(f, 'quantity', 1), setupMinutes: int(f, 'setupMinutes', 45), teardownMinutes: int(f, 'teardownMinutes', 45),
    specs, bundle, upsellIds: f.getAll('upsell').map(String).filter((id) => validIds.has(id)),
    isWet: bool(f, 'isWet'), featured: bool(f, 'featured'), active: bool(f, 'active'), sort: int(f, 'sort', 0),
    seoTitle: str(f, 'seoTitle', 70) || null, seoDescription: str(f, 'seoDescription', 170) || null,
  };
  return values;
}
