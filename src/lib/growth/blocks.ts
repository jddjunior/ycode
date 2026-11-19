/**
 * Server-side validation for website blocks. Schemas are generated from the
 * same field definitions the editor uses, so the editor can never save props
 * the storefront doesn't expect. Unknown props are stripped; sizes are capped.
 */
import { z } from 'zod';
import type { Block } from '../../db/schema';
import { BLOCK_DEFS, LIMITS, type FieldDef } from './blockdefs';

const IMG = /^(\/[\w\-./%]*|https:\/\/[^\s"'<>]+)$/;

function fieldSchema(f: FieldDef): z.ZodTypeAny {
  switch (f.kind) {
    case 'text':
    case 'textarea': {
      const s = z.string().trim().max(f.max ?? LIMITS.medium);
      return f.options ? z.enum(f.options as [string, ...string[]]).default(f.options[0] as never) : s.default('');
    }
    case 'image': return z.union([z.literal(''), z.string().trim().max(f.max ?? 500).regex(IMG, 'Image must be a /path or https:// URL')]).default('');
    case 'bool': return z.boolean().default(false);
    case 'number': return z.number().int().min(f.min ?? 0).max(f.max ?? 100).default(f.min ?? 0);
    case 'lines': return z.array(z.string().trim().min(1).max(LIMITS.short)).max(f.max ?? LIMITS.listItems).default([]);
    case 'repeater': {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const sf of f.fields ?? []) shape[sf.key] = fieldSchema(sf);
      return z.array(z.object(shape)).max(f.max ?? LIMITS.listItems).default([]);
    }
  }
}

const PROPS: Record<string, z.ZodTypeAny> = Object.fromEntries(BLOCK_DEFS.map((d) => {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of d.fields) shape[f.key] = fieldSchema(f);
  return [d.type, z.object(shape)];
}));

const Envelope = z.object({
  id: z.string().regex(/^[\w-]{1,32}$/),
  type: z.enum(BLOCK_DEFS.map((d) => d.type) as [string, ...string[]]),
  props: z.record(z.string(), z.unknown()).default({}),
});

export function validateBlocks(input: unknown): { ok: true; blocks: Block[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'blocks must be an array' };
  if (input.length > LIMITS.blocks) return { ok: false, error: `At most ${LIMITS.blocks} blocks per page` };
  const out: Block[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const env = Envelope.safeParse(input[i]);
    if (!env.success) return { ok: false, error: `Block ${i + 1}: ${env.error.issues[0]?.message ?? 'invalid'}` };
    if (seen.has(env.data.id)) return { ok: false, error: `Block ${i + 1}: duplicate id` };
    seen.add(env.data.id);
    const p = PROPS[env.data.type].safeParse(env.data.props);
    if (!p.success) {
      const iss = p.error.issues[0];
      return { ok: false, error: `Block ${i + 1} (${env.data.type}) → ${iss?.path.join('.') || 'props'}: ${iss?.message ?? 'invalid'}` };
    }
    out.push({ id: env.data.id, type: env.data.type, props: p.data as Record<string, unknown> });
  }
  if (JSON.stringify(out).length > LIMITS.bytes) return { ok: false, error: 'Page content is too large' };
  return { ok: true, blocks: out };
}
