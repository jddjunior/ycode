/**
 * Demo data: a fully configured operator ("Bounce Brigade Party Rentals",
 * Houston TX), a partner operator, a platform admin, bookings, reviews,
 * campaigns and ledger activity. Idempotent: skips if the demo tenant exists.
 *
 *   Operator login: demo@bounceos.app / bounce-demo-2026
 *   HQ login:       hq@branchavenue.com / branch-hq-2026  (platform admin)
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../src/db/client';
import { provisionTenant } from '../src/lib/provision';
import { hashPassword } from '../src/lib/auth';
import { createBooking, recordPayment } from '../src/lib/booking';
import { onBookingPayment, onSubscriptionPaid, onManagedAdSpend } from '../src/lib/revenue';
import { addDays } from '../src/lib/time';
import { generateSearchAd } from '../src/lib/ai';
import { PLANS } from '../src/lib/plans';

// Passwords: local defaults, overridable per environment (staging sets these from Railway variables).
const DEMO_PW = process.env.SEED_DEMO_PASSWORD || 'bounce-demo-2026';
const PARTNER_PW = process.env.SEED_PARTNER_PASSWORD || 'partner-demo-2026';
const HQ_PW = process.env.SEED_HQ_PASSWORD || 'branch-hq-2026';
const db = await getDb();
const [exists] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, 'bounce-brigade')).limit(1);
if (exists) { console.log('• demo data already present'); process.exit(0); }

// Partner operator first so the demo tenant can be "referred" by it.
const { tenant: partner } = await provisionTenant({
  name: 'Gulf Coast Jumpers', email: 'partner@bounceos.app', password: PARTNER_PW, city: 'Pasadena', state: 'TX', zip: '77502',
  lat: 29.6911, lng: -95.2091, theme: 'splash', serviceCities: ['Baytown', 'League City'], plan: 'starter',
});

const { tenant } = await provisionTenant({
  name: 'Bounce Brigade', email: 'demo@bounceos.app', password: DEMO_PW, ownerName: 'Jordan Rivera', phone: '(713) 555-0142',
  city: 'Houston', state: 'TX', zip: '77008', lat: 29.7989, lng: -95.4103, timezone: 'America/Chicago', theme: 'carnival', plan: 'pro',
  serviceCities: ['Katy', 'Sugar Land', 'Pearland', 'Cypress', 'The Woodlands', 'Spring', 'Bellaire'], referralCode: partner.referralCode,
});
await db.update(schema.tenants).set({ slug: 'bounce-brigade', name: 'Bounce Brigade Party Rentals', status: 'active', addressLine: '1200 Heights Blvd',
  settings: { ...tenant.settings, googleReviewUrl: 'https://g.page/r/example-review-link' },
  integrations: { instagramHandle: 'bouncebrigade', facebookPageId: 'bouncebrigadehtx' } }).where(eq(schema.tenants.id, tenant.id));
const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant.id));

// Neighbourhood facts make city pages genuinely local (research: avoid thin, templated city pages).
const facts: Record<string, { neighborhoods: string[]; parks: string[] }> = {
  houston: { neighborhoods: ['The Heights', 'Montrose', 'Garden Oaks', 'Oak Forest', 'Midtown'], parks: ['Memorial Park', 'Discovery Green'] },
  katy: { neighborhoods: ['Cinco Ranch', 'Cross Creek Ranch', 'Firethorne'], parks: ['Mary Jo Peckham Park'] },
  'sugar-land': { neighborhoods: ['First Colony', 'Telfair', 'Riverstone'], parks: ['Oyster Creek Park'] },
  pearland: { neighborhoods: ['Shadow Creek Ranch', 'Silverlake'], parks: ['Independence Park'] },
  cypress: { neighborhoods: ['Bridgeland', 'Towne Lake', 'Coles Crossing'], parks: ['Telge Park'] },
};
for (const [slug, f] of Object.entries(facts)) {
  const [p] = await db.select().from(schema.pages).where(eq(schema.pages.slug, slug));
  if (p?.local) await db.update(schema.pages).set({ local: { ...p.local, ...f, zips: [], deliveryNote: 'Free delivery on orders over $250.' } }).where(eq(schema.pages.id, p.id));
}

await db.update(schema.deliveryZones).set({ zips: ['77007', '77008', '77009', '77018', '77019', '77006', '77098'], feeCents: 0 }).where(eq(schema.deliveryZones.name, 'Local'));
await db.insert(schema.deliveryZones).values({ tenantId: t.id, name: 'Suburbs', zips: ['77494', '77450', '77479', '77478', '77584', '77581', '77429', '77433', '77380', '77381', '77373', '77401'], feeCents: 3500, minOrderCents: 15000, sort: 1 });

const cats = Object.fromEntries((await db.select().from(schema.categories).where(eq(schema.categories.tenantId, t.id))).map((c) => [c.slug, c.id]));

type I = typeof schema.items.$inferInsert;
const mk = (x: Partial<I> & Pick<I, 'slug' | 'name' | 'priceCents'>): I => ({ tenantId: t.id, ...x });
const items = await db.insert(schema.items).values([
  mk({ slug: 'rainbow-castle-bounce-house', name: 'Rainbow Castle Bounce House', categoryId: cats['bounce-houses'], priceCents: 17500, extraHourCents: 1500, overnightCents: 22500, quantity: 3, featured: true, images: ['/demo/castle-rainbow.svg'],
    tagline: 'Our best-seller: bright, roomy and perfect for ages 3–12.', description: 'The Rainbow Castle is the backyard classic. A big 13 × 13 ft jump area, mesh walls so parents can see in, a covered roof for shade, and a front ramp for easy entry.', specs: { lengthFt: 15, widthFt: 15, heightFt: 15, setupAreaFt: '19 x 19', ageRange: '3-12', maxRiders: 6, outlets: 1, blowers: 1, surfaces: ['grass', 'concrete', 'indoor'], theme: 'Rainbow' } }),
  mk({ slug: 'classic-castle-bounce-house', name: 'Classic Castle Bounce House', categoryId: cats['bounce-houses'], priceCents: 15000, extraHourCents: 1500, quantity: 2, images: ['/demo/castle-classic.svg'],
    tagline: 'Timeless red, blue and yellow fun.', description: 'A sturdy commercial-grade bounce house in primary colors that goes with every party theme.', specs: { lengthFt: 13, widthFt: 13, heightFt: 14, setupAreaFt: '17 x 17', ageRange: '3-12', maxRiders: 5, outlets: 1, blowers: 1, surfaces: ['grass', 'concrete', 'indoor'] } }),
  mk({ slug: 'princess-palace-bounce-house', name: 'Princess Palace Bounce House', categoryId: cats['bounce-houses'], priceCents: 17500, quantity: 1, featured: true, images: ['/demo/castle-pink.svg'],
    tagline: 'Pink, purple and ready for royalty.', description: 'Turrets, a sparkle-print roof and plenty of room for a royal birthday court.', specs: { lengthFt: 15, widthFt: 15, heightFt: 16, setupAreaFt: '19 x 19', ageRange: '3-10', maxRiders: 6, outlets: 1, blowers: 1, surfaces: ['grass', 'concrete', 'indoor'], theme: 'Princess' } }),
  mk({ slug: 'modern-white-bounce-house', name: 'Modern White Bounce House', categoryId: cats['bounce-houses'], priceCents: 29500, quantity: 1, featured: true, images: ['/demo/castle-white.svg'],
    tagline: 'Picture-perfect for weddings, showers and first birthdays.', description: 'An elegant all-white bounce house that photographs beautifully. Add a balloon garland for the full look. Adults welcome.', specs: { lengthFt: 15, widthFt: 15, heightFt: 13, setupAreaFt: '19 x 19', ageRange: '3+ (adults OK)', maxRiders: 4, maxWeightLbs: 800, outlets: 1, blowers: 1, surfaces: ['grass', 'indoor'], theme: 'Modern white' } }),
  mk({ slug: 'jungle-combo-bouncer-slide', name: 'Jungle Combo Bouncer with Slide', categoryId: cats['combo-bouncers'], priceCents: 25500, extraHourCents: 2000, quantity: 2, featured: true, images: ['/demo/combo-jungle.svg'],
    tagline: 'Bounce, climb and slide — all in one.', description: 'A jungle-themed 4-in-1 combo with a jump area, climbing wall, slide and basketball hoop.', specs: { lengthFt: 23, widthFt: 18, heightFt: 15, setupAreaFt: '27 x 22', ageRange: '4-14', maxRiders: 8, outlets: 1, blowers: 1, surfaces: ['grass', 'concrete'] } }),
  mk({ slug: 'princess-combo-bouncer-slide', name: 'Princess Combo Bouncer with Slide', categoryId: cats['combo-bouncers'], priceCents: 25500, quantity: 1, images: ['/demo/combo-princess.svg'],
    tagline: 'Royal bouncing with a built-in slide.', description: 'Our princess combo adds a slide and climbing wall to the castle experience.', specs: { lengthFt: 22, widthFt: 17, heightFt: 15, setupAreaFt: '26 x 21', ageRange: '4-12', maxRiders: 7, outlets: 1, blowers: 1, surfaces: ['grass', 'concrete'] } }),
  mk({ slug: 'ocean-wave-wet-dry-combo', name: 'Ocean Wave Wet/Dry Combo', categoryId: cats['combo-bouncers'], priceCents: 27500, quantity: 1, isWet: true, images: ['/demo/combo-ocean.svg'],
    tagline: 'Use it dry or add water for a splash pool.', description: 'An ocean-themed combo with a removable splash pool — the best of both worlds for summer parties.', specs: { lengthFt: 25, widthFt: 18, heightFt: 15, setupAreaFt: '29 x 22', ageRange: '4-14', maxRiders: 8, outlets: 1, blowers: 1, surfaces: ['grass'] } }),
  mk({ slug: '18ft-tropical-water-slide', name: '18ft Tropical Water Slide', categoryId: cats['water-slides'], priceCents: 32500, extraHourCents: 2500, quantity: 2, featured: true, isWet: true, images: ['/demo/slide-tropical.svg'],
    tagline: 'Our most-booked summer slide with a big splash pool.', description: 'An 18 ft tall tropical slide with a climb-up ladder, wide slide lane and deep splash landing. Needs a garden hose within 50 ft.', specs: { lengthFt: 33, widthFt: 12, heightFt: 18, setupAreaFt: '37 x 16', ageRange: '5+', maxRiders: 3, outlets: 1, blowers: 1, surfaces: ['grass'] } }),
  mk({ slug: '22ft-dual-lane-water-slide', name: '22ft Dual Lane Water Slide', categoryId: cats['water-slides'], priceCents: 42500, quantity: 1, isWet: true, images: ['/demo/slide-dual.svg'],
    tagline: 'Race side by side down 22 feet of splash.', description: 'Dual lanes for racing, a tall climb, and a long splash pool. A favorite for school field days and teen parties.', specs: { lengthFt: 40, widthFt: 16, heightFt: 22, setupAreaFt: '44 x 20', ageRange: '6+', maxRiders: 4, outlets: 2, blowers: 2, surfaces: ['grass'] } }),
  mk({ slug: '16ft-dry-slide', name: '16ft Dry Slide', categoryId: cats['water-slides'], priceCents: 27500, quantity: 1, images: ['/demo/slide-dry.svg'],
    tagline: 'Big slide fun, all year round.', description: 'A tall dry slide that works in any season — great for fall festivals and indoor gyms with high ceilings.', specs: { lengthFt: 30, widthFt: 12, heightFt: 16, setupAreaFt: '34 x 16', ageRange: '4+', maxRiders: 3, outlets: 1, blowers: 1, surfaces: ['grass', 'concrete', 'indoor'] } }),
  mk({ slug: '40ft-obstacle-course', name: '40ft Obstacle Course', categoryId: cats['obstacle-courses'], priceCents: 39500, quantity: 1, featured: true, images: ['/demo/obstacle-40.svg'],
    tagline: 'Two-lane racing through pop-ups, tunnels and a slide finish.', description: 'A 40 ft two-lane course with pop-up obstacles, a crawl tunnel, a climbing wall and a slide finish. Perfect for schools, churches and corporate events.', specs: { lengthFt: 40, widthFt: 10, heightFt: 13, setupAreaFt: '44 x 14', ageRange: '5+', maxRiders: 6, outlets: 2, blowers: 2, surfaces: ['grass', 'concrete', 'indoor'] } }),
  mk({ slug: 'ninja-warrior-obstacle-course', name: 'Ninja Warrior Obstacle Course', categoryId: cats['obstacle-courses'], priceCents: 49500, quantity: 1, images: ['/demo/obstacle-ninja.svg'],
    tagline: 'For big kids, teens and adults who like a challenge.', description: 'A tough, adult-rated course with balance beams, a warped wall climb and a final slide.', specs: { lengthFt: 60, widthFt: 12, heightFt: 16, setupAreaFt: '64 x 16', ageRange: '8+ (adults OK)', maxRiders: 6, outlets: 3, blowers: 3, surfaces: ['grass'] } }),
  mk({ slug: 'giant-velcro-dart-game', name: 'Giant Velcro Dart Game', categoryId: cats['interactive-games'], priceCents: 19500, quantity: 1, images: ['/demo/game-dart.svg'],
    tagline: 'Big-target fun for all ages.', description: 'A giant inflatable dartboard with velcro balls — a hit at carnivals and company picnics.', specs: { lengthFt: 10, widthFt: 6, heightFt: 12, setupAreaFt: '14 x 20', ageRange: '3+', outlets: 1, blowers: 1, surfaces: ['grass', 'concrete', 'indoor'] } }),
  mk({ slug: 'soccer-shootout-game', name: 'Soccer Shootout Game', categoryId: cats['interactive-games'], priceCents: 17500, quantity: 1, images: ['/demo/game-soccer.svg'],
    tagline: 'Test your aim on the inflatable goal.', description: 'An inflatable soccer goal with target holes — great for sports parties and field days.', specs: { lengthFt: 15, widthFt: 10, heightFt: 10, setupAreaFt: '19 x 25', ageRange: '4+', outlets: 1, blowers: 1, surfaces: ['grass', 'indoor'] } }),
  mk({ slug: 'cotton-candy-machine', name: 'Cotton Candy Machine', categoryId: cats['concessions'], kind: 'addon', priceCents: 6500, quantity: 3, images: ['/demo/cotton-candy.svg'], setupMinutes: 10, teardownMinutes: 10,
    tagline: 'Includes supplies for 50 servings.', description: 'Commercial cotton candy machine with sugar, cones and bags for 50 servings.', specs: { outlets: 1 } }),
  mk({ slug: 'snow-cone-machine', name: 'Snow Cone Machine', categoryId: cats['concessions'], kind: 'addon', priceCents: 6500, quantity: 2, images: ['/demo/snow-cone.svg'], setupMinutes: 10, teardownMinutes: 10,
    tagline: 'Includes syrups and cups for 50 servings.', description: 'Shaved-ice machine with three syrup flavors and cups for 50 servings.', specs: { outlets: 1 } }),
  mk({ slug: '20x20-party-tent', name: '20x20 Party Tent', categoryId: cats['tables-chairs-tents'], priceCents: 22500, quantity: 2, images: ['/demo/tent.svg'],
    tagline: 'Shade for up to 40 guests.', description: 'A 20 × 20 ft frame tent — seats up to 40 guests at round tables.', specs: { lengthFt: 20, widthFt: 20, heightFt: 12, setupAreaFt: '24 x 24', surfaces: ['grass', 'concrete'] } }),
  mk({ slug: 'quiet-generator', name: 'Quiet Generator', categoryId: cats['add-ons'], kind: 'addon', priceCents: 7500, quantity: 4, images: ['/demo/generator.svg'], setupMinutes: 10, teardownMinutes: 10,
    tagline: 'No outlet? No problem. Required at most parks.', description: 'A quiet inverter generator that powers one blower for a full event. Fuel included.', specs: {} }),
]).returning();

const byslug = Object.fromEntries(items.map((i) => [i.slug, i]));
const addons = [byslug['cotton-candy-machine'].id, byslug['snow-cone-machine'].id, byslug['quiet-generator'].id];
for (const it of items.filter((i) => i.kind === 'rental')) {
  await db.update(schema.items).set({ upsellIds: addons }).where(eq(schema.items.id, it.id));
}
await db.insert(schema.items).values([
  mk({ slug: 'backyard-birthday-package', name: 'Backyard Birthday Package', kind: 'package', categoryId: cats['combo-bouncers'], priceCents: 29500, quantity: 1, featured: true, images: ['/demo/combo-jungle.svg'],
    tagline: 'Combo bouncer + cotton candy. Save $25.', description: 'Everything for an epic backyard birthday: the Jungle Combo plus a cotton candy machine with supplies for 50.',
    bundle: [{ itemId: byslug['jungle-combo-bouncer-slide'].id, qty: 1 }, { itemId: byslug['cotton-candy-machine'].id, qty: 1 }] }),
  mk({ slug: 'summer-splash-package', name: 'Summer Splash Package', kind: 'package', categoryId: cats['water-slides'], priceCents: 37500, quantity: 1, featured: true, images: ['/demo/slide-tropical.svg'], isWet: true,
    tagline: '18ft water slide + snow cones. Save $15.', description: 'The ultimate summer combo: our Tropical Water Slide plus a snow cone machine.',
    bundle: [{ itemId: byslug['18ft-tropical-water-slide'].id, qty: 1 }, { itemId: byslug['snow-cone-machine'].id, qty: 1 }] }),
  mk({ slug: 'school-field-day-package', name: 'School Field Day Package', kind: 'package', categoryId: cats['obstacle-courses'], priceCents: 79500, quantity: 1, images: ['/demo/obstacle-40.svg'],
    tagline: 'Obstacle course + dual slide + dart game. Save $120.', description: 'A full field-day setup for schools and churches. Attendant available.',
    bundle: [{ itemId: byslug['40ft-obstacle-course'].id, qty: 1 }, { itemId: byslug['22ft-dual-lane-water-slide'].id, qty: 1 }, { itemId: byslug['giant-velcro-dart-game'].id, qty: 1 }] }),
]);

await db.insert(schema.reviews).values([
  { tenantId: t.id, author: 'Ashley M.', rating: 5, source: 'google', body: 'On time, super friendly, and the bounce house was spotless. The online booking took two minutes. Already booked again for my son’s party!' },
  { tenantId: t.id, author: 'Marcus T.', rating: 5, source: 'google', body: 'The 18ft water slide was the hit of the summer. The crew set up fast and walked us through the safety rules.' },
  { tenantId: t.id, author: 'Priya S.', rating: 5, source: 'facebook', body: 'We used them for our school field day — the obstacle course and slide kept 300 kids busy all day. Very professional.' },
  { tenantId: t.id, author: 'Danielle R.', rating: 5, source: 'google', body: 'Loved that I could see exactly what was available for my date and the delivery fee up front. No back and forth.' },
  { tenantId: t.id, author: 'Kevin L.', rating: 4, source: 'google', body: 'Great experience. They texted when they were on the way and the white bounce house looked amazing in our photos.' },
  { tenantId: t.id, author: 'Hope Community Church', rating: 5, source: 'direct', body: 'They provided our certificate of insurance same day and handled everything for our fall festival.' },
]);

await db.insert(schema.coupons).values({ tenantId: t.id, code: 'BOOKONLINE', amountOffCents: 2500, active: true });

// Bookings: a few in the past (completed, paid) and upcoming.
const today = new Date().toISOString().slice(0, 10);
const people = [
  ['Ashley Martin', 'ashley@example.com', '(713) 555-0101', '77008', 'Lily', '2019-06-14'],
  ['Marcus Thompson', 'marcus@example.com', '(713) 555-0102', '77494', 'Jayden', '2016-07-02'],
  ['Danielle Ruiz', 'danielle@example.com', '(713) 555-0103', '77007', 'Sofia', '2020-03-21'],
  ['Kevin Lee', 'kevin@example.com', '(713) 555-0104', '77019', null, null],
  ['Brianna Scott', 'brianna@example.com', '(713) 555-0105', '77479', 'Noah', '2018-12-05'],
  ['Tyler Nguyen', 'tyler@example.com', '(713) 555-0106', '77009', 'Ava', '2017-08-19'],
] as const;
const plan: [number, string, string[]][] = [
  [-20, 'rainbow-castle-bounce-house', ['cotton-candy-machine']], [-13, '18ft-tropical-water-slide', []], [-6, 'jungle-combo-bouncer-slide', ['snow-cone-machine']],
  [3, 'rainbow-castle-bounce-house', ['quiet-generator']], [3, '22ft-dual-lane-water-slide', []], [4, 'modern-white-bounce-house', ['cotton-candy-machine']],
  [10, '40ft-obstacle-course', []], [11, 'backyard-birthday-package', []],
];
const coords: Record<string, [number, number]> = { '77008': [29.799, -95.418], '77494': [29.739, -95.828], '77007': [29.771, -95.405], '77019': [29.752, -95.413], '77479': [29.578, -95.623], '77009': [29.79, -95.367] };
let i = 0;
for (const [offset, slug, extras] of plan) {
  const p = people[i++ % people.length];
  const day = addDays(today, offset);
  const lines = [{ itemId: (await db.select().from(schema.items).where(eq(schema.items.slug, slug)))[0].id, qty: 1 }, ...extras.map((e) => ({ itemId: byslug[e].id, qty: 1 }))];
  const { booking } = await createBooking(t, {
    window: { day, startHour: 11, endHour: 17 }, lines, zip: p[3], surface: 'grass', damageWaiver: true,
    customer: { name: p[0], email: p[1], phone: p[2], celebrantName: p[4], celebrantBirthday: p[5], marketingOptIn: true, smsOptIn: true },
    address: `${100 + i * 37} Demo St`, city: 'Houston', state: 'TX', status: 'pending', skipRules: true,
    agreement: { name: p[0], ip: '127.0.0.1', text: t.settings.rentalAgreement ?? '' },
    attribution: { channel: (['organic', 'paid_search', 'marketplace', 'social', 'email'] as const)[i % 5], utmSource: i % 5 === 1 ? 'google' : undefined },
  });
  await db.update(schema.bookings).set({ lat: coords[p[3]][0], lng: coords[p[3]][1] }).where(eq(schema.bookings.id, booking.id));
  const ref = `demo_seed_${booking.id}`;
  await recordPayment(t.id, booking.id, { provider: 'demo', ref, amountCents: offset < 0 ? booking.totalCents : booking.depositCents, applicationFeeCents: booking.platformFeeCents });
  await onBookingPayment({ tenantId: t.id, bookingId: booking.id, paymentRef: ref, amountCents: booking.depositCents, applicationFeeCents: booking.platformFeeCents });
  if (offset < 0) await db.update(schema.bookings).set({ status: 'completed', deliveredAt: new Date(), pickedUpAt: new Date() }).where(eq(schema.bookings.id, booking.id));
}

await db.insert(schema.leads).values([
  { tenantId: t.id, name: 'Rachel G.', email: 'rachel@example.com', phone: '(713) 555-0199', eventDate: addDays(today, 17), zip: '77450', source: 'abandoned_checkout', cart: [{ itemId: byslug['18ft-tropical-water-slide'].id, qty: 1 }] },
  { tenantId: t.id, name: 'Oak Forest Elementary PTA', email: 'pta@example.org', eventDate: addDays(today, 30), zip: '77018', source: 'quote_form', message: 'Field day for 400 kids — need obstacle course + 2 slides + attendants.' },
]);

await db.insert(schema.campaigns).values([
  { tenantId: t.id, name: 'Birthday re-book (30 days before)', channel: 'email', kind: 'birthday', status: 'automated', subject: '{{celebrant}}’s birthday is coming up 🎈', body: 'Hi {{first_name}},\n\n{{celebrant}}’s birthday is about a month away! Last year’s party was a blast — want to book again? Dates go fast.\n\nCheck your date: {{book_url}}\n\n— {{business}}', sentCount: 42, openCount: 27, clickCount: 11, bookingsAttributed: 6 },
  { tenantId: t.id, name: 'Review request (day after)', channel: 'sms', kind: 'review', status: 'automated', body: 'Thanks for partying with {{business}}! Would you leave us a quick review? {{review_url}}', sentCount: 61, clickCount: 29 },
  { tenantId: t.id, name: 'Abandoned checkout (1 hour)', channel: 'email', kind: 'abandoned', status: 'automated', subject: 'Still planning your party?', body: 'Hi {{first_name}}, your {{item}} is still available for {{event_date}} — but weekends fill fast. Finish booking: {{book_url}}', sentCount: 18, bookingsAttributed: 4 },
]);

const ad = await generateSearchAd({ business: t.name, city: 'Houston', state: 'TX', category: 'Bounce Houses', finalUrl: '/rentals/bounce-houses', usps: ['Free Delivery & Setup'] });
await db.insert(schema.adCampaigns).values({ tenantId: t.id, network: 'google', name: 'Houston — Bounce Houses', cities: ['Houston'], creative: { adGroups: [ad] }, dailyBudgetCents: 3000, managed: true, status: 'live', spendCents: 41250, clicks: 512, impressions: 9830, conversions: 23 });

// HQ ledger: subscription invoices (drive referral commission), managed ads fee.
await onSubscriptionPaid({ tenantId: t.id, invoiceRef: 'demo_inv_1', amountCents: PLANS.pro.monthlyCents });
await onSubscriptionPaid({ tenantId: partner.id, invoiceRef: 'demo_inv_2', amountCents: PLANS.starter.monthlyCents });
const [camp] = await db.select().from(schema.adCampaigns).where(eq(schema.adCampaigns.tenantId, t.id));
await onManagedAdSpend({ tenantId: t.id, campaignId: camp.id, periodKey: 'demo', spendCents: 41250 });

await db.insert(schema.partnerships).values([
  { fromTenantId: t.id, toTenantId: partner.id, shareBps: 1000, status: 'active' },
  { fromTenantId: partner.id, toTenantId: t.id, shareBps: 1000, status: 'active' },
]);

await db.insert(schema.achievements).values([{ tenantId: t.id, key: 'first_booking' }, { tenantId: t.id, key: 'site_live' }, { tenantId: t.id, key: 'five_star' }]);

await db.insert(schema.users).values({ email: 'hq@branchavenue.com', name: 'Branch Avenue HQ', passwordHash: await hashPassword(HQ_PW), isPlatformAdmin: true }).onConflictDoNothing();

console.log('✓ seeded demo data');
const shown = (pw: string, env: string) => (process.env[env] ? `(from ${env})` : pw);
console.log(`  operator: demo@bounceos.app / ${shown(DEMO_PW, 'SEED_DEMO_PASSWORD')}`);
console.log(`  HQ:       hq@branchavenue.com / ${shown(HQ_PW, 'SEED_HQ_PASSWORD')}`);
process.exit(0);
