/**
 * Block editor field definitions — island-safe (no node/db imports).
 * Mirrors the block types produced by src/lib/provision.ts (homeBlocks/cityBlocks)
 * so the storefront renderer and the editor agree on props.
 */

export type FieldKind = 'text' | 'textarea' | 'bool' | 'number' | 'lines' | 'image' | 'repeater';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  max?: number;            // string max length / number max / array max length
  min?: number;
  hint?: string;
  options?: string[];      // for small enum text fields (e.g. trust icon)
  fields?: FieldDef[];     // repeater sub-fields
}

export interface BlockDef { type: string; label: string; description: string; fields: FieldDef[]; defaults: Record<string, unknown> }

export const TRUST_ICONS = ['shield', 'sparkle', 'clock', 'cloud', 'star', 'truck', 'check', 'phone', 'trophy', 'bolt'];

export const LIMITS = {
  blocks: 40,
  short: 140,
  medium: 400,
  long: 8000,
  listItems: 12,
  bytes: 120_000,
} as const;

export const BLOCK_DEFS: BlockDef[] = [
  {
    type: 'hero', label: 'Hero', description: 'Big headline, date search and trust badges. Put it first.',
    fields: [
      { key: 'eyebrow', label: 'Eyebrow', kind: 'text', max: 80 },
      { key: 'headline', label: 'Headline (H1)', kind: 'text', max: 120, hint: 'Name the service and the city, e.g. "Bounce house rentals in Katy".' },
      { key: 'subhead', label: 'Subhead', kind: 'textarea', max: 300 },
      { key: 'image', label: 'Image URL', kind: 'image', max: 500, hint: 'A /path on your site or an https:// URL.' },
      { key: 'imageAlt', label: 'Image alt text', kind: 'text', max: 140, hint: 'Describe the photo for screen readers and Google.' },
      { key: 'showDateSearch', label: 'Show date + ZIP availability search', kind: 'bool' },
      { key: 'badges', label: 'Badges (one per line)', kind: 'lines', max: 5 },
    ],
    defaults: { eyebrow: 'Local delivery', headline: 'Bounce house rentals near you', subhead: 'Pick your date, see what’s available, and book in two minutes.', image: '/demo/hero.svg', imageAlt: 'Bounce house set up in a backyard', showDateSearch: true, badges: ['Delivery & setup included'] },
  },
  {
    type: 'trust', label: 'Trust bar', description: 'Insurance, cleaning, on-time and weather promises.',
    fields: [{ key: 'items', label: 'Items', kind: 'repeater', max: 6, fields: [
      { key: 'icon', label: 'Icon', kind: 'text', max: 20, options: TRUST_ICONS },
      { key: 'title', label: 'Title', kind: 'text', max: 60 },
      { key: 'text', label: 'Text', kind: 'textarea', max: 200 },
    ] }],
    defaults: { items: [{ icon: 'shield', title: 'Fully insured', text: 'Certificate of insurance available.' }] },
  },
  { type: 'categories', label: 'Category grid', description: 'Links to every rental category.', fields: [{ key: 'title', label: 'Title', kind: 'text', max: 100 }], defaults: { title: 'Shop by category' } },
  {
    type: 'featured', label: 'Featured rentals', description: 'Your featured inventory with live prices.',
    fields: [{ key: 'title', label: 'Title', kind: 'text', max: 100 }, { key: 'limit', label: 'How many', kind: 'number', min: 1, max: 24 }],
    defaults: { title: 'Popular this weekend', limit: 8 },
  },
  { type: 'packages', label: 'Party packages', description: 'Bundles that raise order value.', fields: [{ key: 'title', label: 'Title', kind: 'text', max: 100 }], defaults: { title: 'Party packages — save when you bundle' } },
  {
    type: 'steps', label: 'How it works', description: 'Three simple steps to book.',
    fields: [{ key: 'title', label: 'Title', kind: 'text', max: 100 }, { key: 'steps', label: 'Steps', kind: 'repeater', max: 6, fields: [
      { key: 'title', label: 'Step title', kind: 'text', max: 60 },
      { key: 'text', label: 'Step text', kind: 'textarea', max: 200 },
    ] }],
    defaults: { title: 'How it works', steps: [{ title: 'Check your date', text: 'See live availability.' }, { title: 'Reserve online', text: 'Small deposit, instant confirmation.' }, { title: 'Party time', text: 'We deliver, set up and pick up.' }] },
  },
  {
    type: 'reviews', label: 'Reviews', description: 'Your featured reviews.',
    fields: [{ key: 'title', label: 'Title', kind: 'text', max: 100 }, { key: 'limit', label: 'How many', kind: 'number', min: 1, max: 12 }],
    defaults: { title: 'Parents love us', limit: 6 },
  },
  { type: 'areas', label: 'Service areas', description: 'Links to your city pages (great for internal linking).', fields: [{ key: 'title', label: 'Title', kind: 'text', max: 100 }], defaults: { title: 'Areas we serve' } },
  {
    type: 'faq', label: 'FAQ', description: 'Questions parents actually ask.',
    fields: [{ key: 'title', label: 'Title', kind: 'text', max: 100 }, { key: 'faqs', label: 'Questions', kind: 'repeater', max: 12, fields: [
      { key: 'q', label: 'Question', kind: 'text', max: 200 },
      { key: 'a', label: 'Answer', kind: 'textarea', max: 1000 },
    ] }],
    defaults: { title: 'Frequently asked questions', faqs: [{ q: 'Do you set it up?', a: 'Yes — delivery, setup and pickup are included.' }] },
  },
  {
    type: 'cta', label: 'Call to action', description: 'A bold band that sends visitors to booking.',
    fields: [{ key: 'headline', label: 'Headline', kind: 'text', max: 100 }, { key: 'text', label: 'Text', kind: 'text', max: 200 }, { key: 'button', label: 'Button label', kind: 'text', max: 40 }],
    defaults: { headline: 'Weekend dates go fast', text: 'Check your date now — it takes 10 seconds.', button: 'Check availability' },
  },
  { type: 'local', label: 'Local facts (city pages)', description: 'Renders the neighborhoods, parks, venues and FAQs you edit in SEO → local facts.', fields: [], defaults: {} },
  {
    type: 'richtext', label: 'Rich text', description: 'Paragraphs, headings (##), lists (-), **bold** and links.',
    fields: [{ key: 'markdown', label: 'Content (markdown)', kind: 'textarea', max: 8000 }],
    defaults: { markdown: '## A heading\n\nWrite something helpful and local.' },
  },
  {
    type: 'contact', label: 'Contact form', description: 'Quote/contact form that creates a lead.',
    fields: [{ key: 'title', label: 'Title', kind: 'text', max: 100 }, { key: 'text', label: 'Text', kind: 'textarea', max: 400 }],
    defaults: { title: 'Get in touch', text: 'Questions about a date or venue? Send us a note.' },
  },
];

export const BLOCK_TYPES = BLOCK_DEFS.map((d) => d.type);
export const defFor = (type: string) => BLOCK_DEFS.find((d) => d.type === type);

/** Public storefront path for a page (preview link). Mirrors the storefront route scheme. */
export function pagePath(kind: string, slug: string): string {
  if (kind === 'city') return `/areas/${slug}`;
  return slug ? `/${slug}` : '/'; // pages, posts and landing pages share /{slug}
}

/** Storefront product URL: /rentals/{category}/{item}, packages under /rentals/packages/{item}. */
export function itemPath(kind: string, categorySlug: string | null | undefined, slug: string): string {
  if (kind === 'package') return `/rentals/packages/${slug}`;
  return categorySlug ? `/rentals/${categorySlug}/${slug}` : '/rentals';
}
