import { randomBytes, createHash } from 'node:crypto';

export const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function slugify(s: string, max = 60): string {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'item';
}

export function referralCode(name: string) {
  const base = slugify(name, 10).replace(/-/g, '').toUpperCase() || 'BOUNCE';
  return `${base}${randomBytes(2).toString('hex').toUpperCase()}`;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Safe JSON for embedding inside <script type="application/ld+json">. */
export const jsonLd = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export function clampInt(v: unknown, min: number, max: number, dflt: number) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

export const dollarsToCents = (v: unknown) => {
  const n = Number.parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Render a tiny, safe subset of markdown (paragraphs, **bold**, lists, headings, links). Input is escaped first. */
export function miniMarkdown(md: string): string {
  const lines = escapeHtml(md).split(/\r?\n/);
  const out: string[] = [];
  let list = false;
  const inline = (s: string) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
  for (const raw of lines) {
    const l = raw.trim();
    if (/^[-*] /.test(l)) {
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${inline(l.slice(2))}</li>`);
      continue;
    }
    if (list) { out.push('</ul>'); list = false; }
    if (!l) continue;
    const h = /^(#{2,4}) (.*)$/.exec(l);
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else out.push(`<p>${inline(l)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('\n');
}
