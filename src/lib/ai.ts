/**
 * Marketing copy generation.
 *
 * Every generator has a deterministic template implementation so the product
 * works with zero configuration; when ANTHROPIC_API_KEY (or another SDK
 * credential) is configured, Claude writes fresher, local copy via structured
 * outputs. Outputs are always validated (char limits, banned claims) before use.
 *
 * Model: claude-opus-5-5 at low effort (short copy; effort is the cost lever).
 * Override with ANTHROPIC_MODEL. Server-side refusal fallbacks are enabled.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5';

let client: Anthropic | null = null;
export const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
function getClient() { return (client ??= new Anthropic()); }

const SYSTEM = `You write marketing copy for local bounce house and party rental companies in the USA.
Voice: warm, upbeat, parent-friendly, concrete. Mention safety/cleanliness and on-time delivery when natural.
Never invent prices, review counts, awards, licenses or guarantees that weren't given to you. No ALL-CAPS words, no excessive punctuation, at most one emoji per social caption and none in ads.`;

async function structured<T>(prompt: string, schema: Record<string, unknown>): Promise<T | null> {
  if (!aiEnabled()) return null;
  try {
    const params = {
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    };
    // Cast: beta params (fallbacks) may be newer than the installed type defs.
    const res = await getClient().beta.messages.create(params as unknown as Parameters<Anthropic['beta']['messages']['create']>[0]) as Anthropic.Beta.BetaMessage;
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return null;
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.warn(`[ai] ${err.status} ${err.message}`);
    else console.warn('[ai] generation failed', (err as Error).message);
    return null;
  }
}

/* ───────────── Validation ───────────── */

const BANNED = [/\bguarantee(d)?\b/i, /\b#1\b/, /\bbest in\b/i, /\bcheapest\b/i, /!!/];
export const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
export function fit(s: string, max: number): string {
  s = clean(s);
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const i = cut.lastIndexOf(' ');
  return (i > max * 0.6 ? cut.slice(0, i) : s.slice(0, max)).replace(/[,;:\-–—]+$/, '');
}
export const policyOk = (s: string) => !BANNED.some((r) => r.test(s));
const uniq = (xs: string[]) => [...new Set(xs.map(clean).filter(Boolean))];

/* ───────────── Google Search ads ───────────── */

export interface AdInput { business: string; city: string; state: string; category: string; finalUrl: string; usps: string[]; phone?: string }
export interface AdGroup { name: string; keywords: string[]; negativeKeywords: string[]; headlines: string[]; descriptions: string[]; finalUrl: string }

export function keywordsFor(category: string, city: string): string[] {
  const c = category.toLowerCase().replace(/s$/, ''), cl = city.toLowerCase();
  return uniq([
    `${c} rental ${cl}`, `${c} rentals ${cl}`, `${c} rental near me`, `rent a ${c} ${cl}`,
    `${c} for party ${cl}`, `${cl} ${c} rental`, `${c} rental prices ${cl}`, `birthday ${c} rental ${cl}`,
  ]).map((k) => `[${k}]`).concat([`"${c} rental ${cl}"`, `"${c} rentals near me"`]);
}

export const NEGATIVES = ['buy', 'for sale', 'used', 'diy', 'repair', 'jobs', 'hiring', 'craigslist', 'wholesale', 'commercial grade for sale', 'free'];

function templateAd(i: AdInput): AdGroup {
  const cat = i.category.replace(/s$/, '');
  const heads = [
    `${cat} Rentals in ${i.city}`, `${i.city} ${cat} Rental`, `Book Your ${cat} Online`, `See Live Availability`,
    `Delivered & Set Up For You`, `Clean, Inspected Units`, `${i.business}`, `Reserve With a Small Deposit`,
    `Party Rentals ${i.city}, ${i.state}`, `Instant Online Booking`, `Weekend Dates Go Fast`, `Free Setup & Takedown`,
    ...i.usps,
  ];
  const descs = [
    `Check your date and book in minutes. We deliver, set up and pick up across ${i.city}.`,
    `Clean, inspected ${i.category.toLowerCase()} for birthdays, schools and church events. Reserve online today.`,
    `Pick a date, see what's available, and lock it in with a small deposit. Fully insured and on time.`,
    `Local, family-friendly rentals in ${i.city}. Easy online booking, friendly crew, spotless equipment.`,
  ];
  return {
    name: `${i.category} — ${i.city}`, keywords: keywordsFor(i.category, i.city), negativeKeywords: NEGATIVES,
    headlines: uniq(heads.map((h) => fit(h, 30))).filter(policyOk).slice(0, 15),
    descriptions: uniq(descs.map((d) => fit(d, 90))).filter(policyOk).slice(0, 4),
    finalUrl: i.finalUrl,
  };
}

export async function generateSearchAd(i: AdInput): Promise<AdGroup> {
  const base = templateAd(i);
  const ai = await structured<{ headlines: string[]; descriptions: string[] }>(
    `Write a Google Responsive Search Ad for "${i.business}", a ${i.category.toLowerCase()} rental company serving ${i.city}, ${i.state}.
Selling points (only use these as facts): ${i.usps.join('; ') || 'online booking, delivery and setup included'}.
Give 15 headlines (each ≤ 30 characters, at least 3 containing "${i.city}") and 4 descriptions (each ≤ 90 characters, each ending with a call to action).`,
    { type: 'object', additionalProperties: false, required: ['headlines', 'descriptions'],
      properties: { headlines: { type: 'array', items: { type: 'string' } }, descriptions: { type: 'array', items: { type: 'string' } } } },
  );
  if (!ai) return base;
  const h = uniq(ai.headlines).filter((x) => x.length <= 30 && policyOk(x));
  const d = uniq(ai.descriptions).filter((x) => x.length <= 90 && policyOk(x));
  return {
    ...base,
    headlines: uniq([...h, ...base.headlines]).slice(0, 15),
    descriptions: uniq([...d, ...base.descriptions]).slice(0, 4),
  };
}

/* ───────────── Meta ads ───────────── */

export async function generateMetaPrimaryText(i: AdInput): Promise<string[]> {
  const base = [
    `Party planning just got easier 🎉 ${i.business} delivers, sets up and picks up ${i.category.toLowerCase()} all over ${i.city}. Check your date and book online in two minutes.`,
    `Weekend dates in ${i.city} fill up fast. See live availability, reserve with a small deposit, and let our crew handle the rest.`,
    `Clean, inspected and delivered on time — that's the ${i.business} promise. Book your ${i.category.toLowerCase().replace(/s$/, '')} today.`,
  ];
  const ai = await structured<{ texts: string[] }>(
    `Write 3 Facebook/Instagram ad primary texts (each 90-160 characters) for ${i.business}, ${i.category.toLowerCase()} rentals in ${i.city}, ${i.state}. Facts: ${i.usps.join('; ') || 'online booking, delivery and setup included'}.`,
    { type: 'object', additionalProperties: false, required: ['texts'], properties: { texts: { type: 'array', items: { type: 'string' } } } },
  );
  return uniq([...(ai?.texts ?? []).filter((t) => t.length <= 220 && policyOk(t)), ...base]).slice(0, 3);
}

/* ───────────── Social captions ───────────── */

export interface CaptionInput { business: string; city: string; itemName?: string; itemTagline?: string; occasion?: string; link?: string; tone?: 'fun' | 'helpful' | 'urgent' }

export async function generateCaptions(i: CaptionInput): Promise<string[]> {
  const thing = i.itemName ?? 'our bounce houses';
  const occ = i.occasion ?? 'your next party';
  const link = i.link ? ` Book: ${i.link}` : '';
  const base = [
    `Meet ${thing}! ${i.itemTagline ?? 'The backyard upgrade your kids will talk about for weeks.'} Now booking ${occ} dates in ${i.city}.${link}`,
    `Saturday plans: solved ☀️ We deliver, set up and pick up — you just enjoy the party. Check your date for ${thing}.${link}`,
    `Every unit is cleaned and inspected before it reaches your yard. That's how ${i.business} does ${occ} in ${i.city}.${link}`,
  ];
  const ai = await structured<{ captions: string[] }>(
    `Write 3 social captions (Facebook/Instagram/Google Business Profile, each 120-260 characters, ${i.tone ?? 'fun'} tone) for ${i.business} in ${i.city} featuring ${thing}${i.itemTagline ? ` (${i.itemTagline})` : ''} for ${occ}. End each with a short call to action${i.link ? ` and this link: ${i.link}` : ''}. Add 2-3 local hashtags to one of them.`,
    { type: 'object', additionalProperties: false, required: ['captions'], properties: { captions: { type: 'array', items: { type: 'string' } } } },
  );
  return uniq([...(ai?.captions ?? []).filter((c) => c.length <= 400 && policyOk(c)), ...base]).slice(0, 3);
}

/* ───────────── SEO copy ───────────── */

export async function generateCityIntro(business: string, city: string, state: string, facts: { neighborhoods?: string[]; parks?: string[] }): Promise<string> {
  const n = facts.neighborhoods?.slice(0, 3).join(', ');
  const p = facts.parks?.slice(0, 2).join(' and ');
  const base = `${business} delivers bounce houses, water slides and party rentals throughout ${city}, ${state}${n ? ` — including ${n}` : ''}. Pick your date online, see exactly what's available, and our crew handles delivery, setup and pickup.${p ? ` Planning a party at ${p}? Ask us about park permits and generator options.` : ''}`;
  const ai = await structured<{ intro: string }>(
    `Write a 70-110 word introduction for the "${city}, ${state}" service-area page of ${business}, a bounce house rental company. Local facts you may use: neighborhoods ${n || 'n/a'}; parks ${p || 'n/a'}. Mention delivery/setup and online booking. No invented facts.`,
    { type: 'object', additionalProperties: false, required: ['intro'], properties: { intro: { type: 'string' } } },
  );
  return ai?.intro && policyOk(ai.intro) ? clean(ai.intro) : base;
}

export async function generateItemDescription(name: string, specs: Record<string, unknown>, city: string): Promise<string> {
  const base = `${name} brings big fun to birthdays, block parties and school events across ${city}. Delivered, set up and safely anchored by our trained crew, then cleaned and inspected after every rental.`;
  const ai = await structured<{ description: string }>(
    `Write a 60-90 word product description for the rental "${name}" (specs: ${JSON.stringify(specs)}), serving ${city}. Mention who it suits (ages/occasions) based on the specs. No invented facts.`,
    { type: 'object', additionalProperties: false, required: ['description'], properties: { description: { type: 'string' } } },
  );
  return ai?.description && policyOk(ai.description) ? clean(ai.description) : base;
}
