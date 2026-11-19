/**
 * Tenant provisioning: one call creates a fully working, SEO-ready operator
 * (settings, site + theme, homepage blocks in the research-backed order,
 * standard pages, categories, delivery zone, city pages).
 */
import { eq } from 'drizzle-orm';
import { getDb, schema, type DB } from '../db/client';
import type { Block, TenantSettings, LocalFacts } from '../db/schema';
import { THEMES } from './themes';
import { slugify, referralCode, token } from './util';
import { hashPassword } from './auth';

export const DEFAULT_AGREEMENT = `## Rental Agreement

- The renter is responsible for the equipment from delivery until pickup and agrees to follow all posted safety rules.
- An adult (18+) must supervise the equipment at all times while in use.
- No shoes, sharp objects, food, drinks, silly string, or face paint inside inflatables.
- Riders must be grouped by similar size. Do not exceed posted rider limits.
- **Stop use immediately in winds over 15 mph, rain, or lightning.** Exit riders and unplug the blower.
- The renter must provide access to a working outlet within 50 feet unless a generator is rented.
- The renter is responsible for damage beyond normal wear (cuts, burns, stains, theft) unless covered by the damage waiver, which covers accidental damage up to the rental value but not negligence or theft.
- Weather: if conditions are unsafe on your event day, we'll reschedule or issue a credit valid for 12 months.
- Cancellations made 48+ hours before delivery receive a full refund of the deposit. Within 48 hours the deposit becomes a credit.`;

export const DEFAULT_SETTINGS: TenantSettings = {
  currency: 'usd', taxRateBps: 825, depositType: 'percent', depositValue: 25,
  damageWaiverBps: 800, damageWaiverDefaultOn: true, passPlatformFeeToCustomer: false,
  minOrderCents: 0, leadTimeHours: 24, maxDaysAhead: 365, holdMinutes: 30, maxEventsPerDay: 12,
  defaultStartHour: 10, defaultEndHour: 18, windLimitMph: 15,
  cancellationPolicy: 'Full refund 48+ hours before delivery. Weather cancellations always get a free reschedule or 12-month credit.',
  rentalAgreement: DEFAULT_AGREEMENT,
  surfaces: [
    { key: 'grass', label: 'Grass', feeCents: 0 },
    { key: 'concrete', label: 'Concrete / asphalt (sandbags)', feeCents: 2500 },
    { key: 'indoor', label: 'Indoor / gym', feeCents: 1500 },
  ],
};

const b = (type: string, props: Record<string, unknown>): Block => ({ id: token(6), type, props });

export function homeBlocks(_name: string, city: string): Block[] {
  return [
    b('hero', {
      eyebrow: `${city}'s friendly party rental crew`,
      headline: `Bounce house & party rentals in ${city}`,
      subhead: 'Pick your date, see what’s actually available, and book in two minutes. Delivery, setup and pickup always included.',
      image: '/demo/hero.svg', showDateSearch: true,
      badges: ['Delivery & setup included', 'Cleaned after every rental', 'Fully insured'],
    }),
    b('trust', { items: [
      { icon: 'shield', title: 'Fully insured', text: 'Certificate of insurance available for schools, churches & parks.' },
      { icon: 'sparkle', title: 'Sanitized every time', text: 'Cleaned, inspected and blower-tested before every delivery.' },
      { icon: 'clock', title: 'On-time arrival window', text: 'We text you when the crew is on the way.' },
      { icon: 'cloud', title: 'Weather-safe promise', text: 'Unsafe wind or rain? Free reschedule or a 12-month credit.' },
    ] }),
    b('categories', { title: 'Shop by category' }),
    b('featured', { title: 'Popular this weekend', limit: 8 }),
    b('packages', { title: 'Party packages — save when you bundle' }),
    b('steps', { title: 'How it works', steps: [
      { title: 'Check your date', text: 'Enter your event date and ZIP to see live availability and delivery fees.' },
      { title: 'Reserve online', text: 'Lock it in with a small deposit and e-sign the rental agreement.' },
      { title: 'We do the rest', text: 'We deliver, set up, safety-check and pick up. You enjoy the party.' },
    ] }),
    b('reviews', { title: 'Parents love us', limit: 6 }),
    b('areas', { title: `Serving ${city} and nearby` }),
    b('faq', { title: 'Frequently asked questions', faqs: [
      { q: 'How much space do I need?', a: 'Each rental lists its setup footprint. Most bounce houses need about 20 × 20 ft of flat space plus a few feet of clearance on every side.' },
      { q: 'Do you set it up?', a: 'Yes — delivery, setup, anchoring and pickup are included with every rental.' },
      { q: 'What if the weather is bad?', a: 'Safety comes first. If wind, rain or lightning make it unsafe we’ll reschedule for free or give you a credit valid for 12 months.' },
      { q: 'Do I need power?', a: 'Most units need one standard outlet within 50 ft per blower. No power? Add a generator at checkout.' },
      { q: 'How much is the deposit?', a: 'A small deposit holds your date; the balance is due on delivery.' },
      { q: 'Can you set up at a park or school?', a: 'Absolutely. We can provide a certificate of insurance, and we’ll tell you about any park permit or generator rules.' },
    ] }),
    b('cta', { headline: 'Weekend dates go fast', text: 'Check your date now — it takes 10 seconds.', button: 'Check availability' }),
  ];
}

export const DEFAULT_CATEGORIES = [
  { slug: 'bounce-houses', name: 'Bounce Houses', description: 'Classic and themed bounce houses for every age.' },
  { slug: 'combo-bouncers', name: 'Combo Bouncers', description: 'Bounce, climb and slide in one unit.' },
  { slug: 'water-slides', name: 'Water Slides', description: 'Beat the heat with wet/dry slides.' },
  { slug: 'obstacle-courses', name: 'Obstacle Courses', description: 'Race your friends through big inflatable courses.' },
  { slug: 'interactive-games', name: 'Interactive Games', description: 'Games for all ages — great for schools & corporate.' },
  { slug: 'tables-chairs-tents', name: 'Tables, Chairs & Tents', description: 'Everything you need to host.' },
  { slug: 'concessions', name: 'Concessions', description: 'Cotton candy, snow cones and popcorn machines.' },
  { slug: 'add-ons', name: 'Add-ons', description: 'Generators, attendants and extras.' },
];

export function cityBlocks(city: string): Block[] {
  return [
    b('hero', { eyebrow: 'Local delivery', headline: `Bounce house rentals in ${city}`, subhead: `Same crew, same spotless equipment — delivered to your ${city} backyard, park, school or church.`, image: '/demo/hero.svg', showDateSearch: true, badges: ['Delivery & setup included'] }),
    b('local', {}),
    b('featured', { title: `Popular in ${city}`, limit: 8 }),
    b('steps', { title: 'Booking is easy', steps: [
      { title: 'Check your date', text: 'See live availability for your address.' },
      { title: 'Reserve online', text: 'Small deposit, instant confirmation.' },
      { title: 'Party time', text: 'We deliver, set up and pick up.' },
    ] }),
    b('reviews', { title: 'Reviews from local families', limit: 3 }),
    b('areas', { title: 'Nearby areas we serve' }),
    b('cta', { headline: `Planning a party in ${city}?`, text: 'Check your date in 10 seconds.', button: 'Check availability' }),
  ];
}

export function cityFacts(city: string, state: string, extra: Partial<LocalFacts> = {}): LocalFacts {
  return {
    city, state, ...extra,
    faqs: extra.faqs ?? [
      { q: `Do you deliver to all of ${city}?`, a: `Yes — we deliver throughout ${city}. Enter your ZIP at checkout to see the exact delivery fee.` },
      { q: `Can I rent a bounce house for a ${city} park?`, a: `Usually yes. Many parks require a permit and a generator; we can supply both a certificate of insurance and a generator rental.` },
      { q: 'How early do you set up?', a: 'Most setups happen 1–3 hours before your start time. We’ll text you an arrival window the day before.' },
    ],
  };
}

export interface ProvisionInput {
  name: string; email: string; password: string; ownerName?: string; phone?: string;
  city: string; state: string; zip: string; lat?: number | null; lng?: number | null; timezone?: string;
  theme?: keyof typeof THEMES; serviceCities?: string[]; referralCode?: string | null; plan?: 'starter' | 'pro' | 'elite';
}

async function uniqueSlug(db: DB, base: string) {
  let slug = slugify(base, 40), n = 1;
  for (;;) {
    const [hit] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1);
    if (!hit && !['www', 'app', 'api', 'hq', 'admin', 'sites', 'find', 'mail'].includes(slug)) return slug;
    slug = `${slugify(base, 36)}-${++n}`;
  }
}

export async function provisionTenant(input: ProvisionInput) {
  const db = await getDb();
  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(db, input.name);
  return db.transaction(async (tx) => {
    let referredBy: string | null = null;
    if (input.referralCode) {
      const [r] = await tx.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.referralCode, input.referralCode.toUpperCase())).limit(1);
      referredBy = r?.id ?? null;
    }
    let [user] = await tx.select().from(schema.users).where(eq(schema.users.email, input.email.toLowerCase())).limit(1);
    if (!user) [user] = await tx.insert(schema.users).values({ email: input.email.toLowerCase(), name: input.ownerName ?? '', passwordHash }).returning();

    const [tenant] = await tx.insert(schema.tenants).values({
      slug, name: input.name, plan: input.plan ?? 'pro', status: 'trial', trialEndsAt: new Date(Date.now() + 30 * 86_400_000),
      phone: input.phone ?? '', email: input.email.toLowerCase(), city: input.city, state: input.state, zip: input.zip,
      lat: input.lat ?? null, lng: input.lng ?? null, timezone: input.timezone ?? 'America/Chicago',
      settings: DEFAULT_SETTINGS, referralCode: referralCode(input.name), referredByTenantId: referredBy,
    }).returning();
    await tx.insert(schema.memberships).values({ tenantId: tenant.id, userId: user.id, role: 'owner' });

    const theme = THEMES[input.theme ?? 'carnival'];
    const { label: _l, mood: _m, fontsHref: _f, ...tokens } = theme;
    await tx.insert(schema.sites).values({
      tenantId: tenant.id, theme: tokens,
      nav: [{ label: 'Rentals', href: '/rentals' }, { label: 'Packages', href: '/rentals/packages' }, { label: 'Service Areas', href: '/areas' }, { label: 'FAQ', href: '/faq' }, { label: 'Contact', href: '/contact' }],
      titleTemplate: `%s | ${input.name}`,
      defaultDescription: `Bounce house, water slide & party rentals in ${input.city}, ${input.state}. Live availability, online booking, delivery & setup included.`,
      footerBlurb: `${input.name} is a locally owned party rental company serving ${input.city} and surrounding areas.`,
      announcement: 'Now booking weekend dates — check availability in 10 seconds.',
    });

    await tx.insert(schema.pages).values([
      { tenantId: tenant.id, slug: '', kind: 'page', title: `Bounce House Rentals ${input.city}, ${input.state}`, seoDescription: `Bounce house & water slide rentals in ${input.city}. See live availability, book online with a small deposit — delivery, setup & pickup included.`, blocks: homeBlocks(input.name, input.city) },
      { tenantId: tenant.id, slug: 'faq', kind: 'page', title: 'Frequently Asked Questions', blocks: [homeBlocks(input.name, input.city).find((x) => x.type === 'faq')!, b('cta', { headline: 'Still have questions?', text: 'Text or call us — we answer fast.', button: 'Check availability' })] },
      { tenantId: tenant.id, slug: 'about', kind: 'page', title: `About ${input.name}`, blocks: [b('richtext', { markdown: `## Locally owned, family run\n\n${input.name} started with one bounce house and a simple promise: show up on time, with clean equipment, and make the party easy.\n\nEvery unit is cleaned, inspected and blower-tested before it reaches your yard.` }), b('trust', homeBlocks(input.name, input.city)[1].props)] },
      { tenantId: tenant.id, slug: 'contact', kind: 'page', title: 'Contact Us', blocks: [b('contact', { title: 'Get in touch', text: 'Questions about a date, a venue, or a big event? Send us a note and we’ll reply quickly.' })] },
      { tenantId: tenant.id, slug: 'safety', kind: 'page', title: 'Safety & Cleaning', blocks: [b('richtext', { markdown: '## Our safety standards\n\n- Every unit is anchored with stakes or sandbags per manufacturer specs.\n- We monitor wind forecasts for every event and will reschedule if winds exceed safe limits.\n- Units are cleaned and sanitized after every rental.\n- Crew members complete a setup checklist and walk you through the safety rules on site.' })] },
    ]);

    await tx.insert(schema.categories).values(DEFAULT_CATEGORIES.map((c, i) => ({ tenantId: tenant.id, ...c, sort: i })));
    await tx.insert(schema.deliveryZones).values([
      { tenantId: tenant.id, name: 'Local', zips: [input.zip], radiusMiles: 15, feeCents: 0, sort: 0 },
      { tenantId: tenant.id, name: 'Extended', zips: [], radiusMiles: 30, feeCents: 4500, minOrderCents: 15000, sort: 1 },
    ]);

    const cities = [...new Set([input.city, ...(input.serviceCities ?? [])])].slice(0, 30);
    if (cities.length) {
      await tx.insert(schema.pages).values(cities.map((c) => ({
        tenantId: tenant.id, slug: slugify(c), kind: 'city' as const, title: `Bounce House Rentals ${c}, ${input.state}`,
        seoDescription: `Bounce house & party rentals delivered in ${c}, ${input.state}. Check live availability and book online — setup & pickup included.`,
        blocks: cityBlocks(c), local: cityFacts(c, input.state),
      })));
    }
    await tx.insert(schema.activity).values({ tenantId: tenant.id, kind: 'welcome', message: `Welcome to BounceOS, ${input.name}! Your site is live.` });
    return { tenant, user };
  });
}
