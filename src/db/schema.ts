/**
 * BounceOS data model.
 *
 * Multi-tenant: every operator-owned row carries `tenantId`. All access goes
 * through tenant-scoped helpers in src/lib — never query operator tables
 * without a tenantId predicate.
 *
 * Money is stored as integer cents. Timestamps are timestamptz.
 */
import {
  pgTable, text, integer, boolean, timestamp, jsonb, uuid, index, uniqueIndex,
  doublePrecision, primaryKey, date,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const tenantRef = () => uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' });

/* ───────────────────────── Platform / identity ───────────────────────── */

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull(),
  name: text('name').notNull().default(''),
  passwordHash: text('password_hash').notNull(),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)]);

export const sessions = pgTable('sessions', {
  /** sha256 of the opaque cookie token — the raw token is never stored. */
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  activeTenantId: uuid('active_tenant_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export type PlanId = 'starter' | 'pro' | 'elite';

export const tenants = pgTable('tenants', {
  id: id(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  plan: text('plan').$type<PlanId>().notNull().default('starter'),
  status: text('status').$type<'trial' | 'active' | 'past_due' | 'canceled'>().notNull().default('trial'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  /** Business profile */
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  addressLine: text('address_line').notNull().default(''),
  city: text('city').notNull().default(''),
  state: text('state').notNull().default(''),
  zip: text('zip').notNull().default(''),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  timezone: text('timezone').notNull().default('America/Chicago'),
  logoUrl: text('logo_url'),
  /** Booking rules & money settings (see TenantSettings) */
  settings: jsonb('settings').$type<TenantSettings>().notNull().default(sql`'{}'::jsonb`),
  /** Stripe Connect */
  stripeAccountId: text('stripe_account_id'),
  stripeChargesEnabled: boolean('stripe_charges_enabled').notNull().default(false),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  /** Growth */
  referralCode: text('referral_code').notNull(),
  referredByTenantId: uuid('referred_by_tenant_id'),
  marketplaceListed: boolean('marketplace_listed').notNull().default(true),
  /** Integrations / tracking (public IDs only — secrets live in the vault) */
  integrations: jsonb('integrations').$type<TenantIntegrations>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('tenants_slug_uq').on(t.slug), uniqueIndex('tenants_ref_uq').on(t.referralCode)]);

export interface TenantSettings {
  currency?: string;              // 'usd'
  taxRateBps?: number;            // 825 = 8.25%
  depositType?: 'percent' | 'fixed' | 'full';
  depositValue?: number;          // percent (0-100) or cents
  damageWaiverBps?: number;       // optional damage waiver, e.g. 800 = 8%
  damageWaiverDefaultOn?: boolean;
  passPlatformFeeToCustomer?: boolean;
  minOrderCents?: number;
  leadTimeHours?: number;         // min hours before event to book online
  maxDaysAhead?: number;
  holdMinutes?: number;           // cart hold
  maxEventsPerDay?: number;       // crew/truck capacity
  defaultStartHour?: number;      // 9
  defaultEndHour?: number;        // 17
  windLimitMph?: number;          // safety cutoff, ANSI/ASTM guidance ~15-20mph
  cancellationPolicy?: string;
  rentalAgreement?: string;       // markdown; customers e-sign at checkout
  googleReviewUrl?: string;
  surfaces?: { key: string; label: string; feeCents: number }[];
}

export interface TenantIntegrations {
  ga4Id?: string;
  metaPixelId?: string;
  googleAdsConversionId?: string;
  googleAdsConversionLabel?: string;
  gbpLocationId?: string;
  facebookPageId?: string;
  instagramHandle?: string;
  tiktokHandle?: string;
}

export const memberships = pgTable('memberships', {
  tenantId: tenantRef(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<'owner' | 'manager' | 'crew'>().notNull().default('owner'),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId] })]);

export const domains = pgTable('domains', {
  id: id(),
  tenantId: tenantRef(),
  hostname: text('hostname').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  verified: boolean('verified').notNull().default(false),
  verificationToken: text('verification_token').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('domains_host_uq').on(t.hostname)]);

/* ───────────────────────── Inventory ───────────────────────── */

export const categories = pgTable('categories', {
  id: id(),
  tenantId: tenantRef(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sort: integer('sort').notNull().default(0),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
}, (t) => [uniqueIndex('categories_slug_uq').on(t.tenantId, t.slug)]);

export const items = pgTable('items', {
  id: id(),
  tenantId: tenantRef(),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  kind: text('kind').$type<'rental' | 'addon' | 'package'>().notNull().default('rental'),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  tagline: text('tagline').notNull().default(''),
  description: text('description').notNull().default(''),
  images: jsonb('images').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Pricing (cents) */
  priceCents: integer('price_cents').notNull(),        // covers baseHours
  baseHours: integer('base_hours').notNull().default(8),
  extraHourCents: integer('extra_hour_cents').notNull().default(0),
  overnightCents: integer('overnight_cents'),
  /** Inventory */
  quantity: integer('quantity').notNull().default(1),
  setupMinutes: integer('setup_minutes').notNull().default(45),
  teardownMinutes: integer('teardown_minutes').notNull().default(45),
  /** Specs that drive conversion + safety */
  specs: jsonb('specs').$type<ItemSpecs>().notNull().default(sql`'{}'::jsonb`),
  /** Package contents: [{itemId, qty}] */
  bundle: jsonb('bundle').$type<{ itemId: string; qty: number }[]>().notNull().default(sql`'[]'::jsonb`),
  /** Upsell add-on item ids */
  upsellIds: jsonb('upsell_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  isWet: boolean('is_wet').notNull().default(false),
  featured: boolean('featured').notNull().default(false),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('items_slug_uq').on(t.tenantId, t.slug), index('items_tenant_idx').on(t.tenantId)]);

export interface ItemSpecs {
  lengthFt?: number; widthFt?: number; heightFt?: number;
  setupAreaFt?: string;          // "20x20"
  ageRange?: string;             // "3-12"
  maxRiders?: number;
  maxWeightLbs?: number;
  outlets?: number;              // 110v outlets required
  blowers?: number;
  surfaces?: string[];           // grass, concrete, asphalt, indoor
  material?: string;
  theme?: string;
}

export const maintenanceLogs = pgTable('maintenance_logs', {
  id: id(),
  tenantId: tenantRef(),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'cleaning' | 'repair' | 'inspection' | 'retired'>().notNull(),
  note: text('note').notNull().default(''),
  costCents: integer('cost_cents').notNull().default(0),
  /** Unit out of service until this time (null = in service). */
  outOfServiceUntil: timestamp('out_of_service_until', { withTimezone: true }),
  unitsAffected: integer('units_affected').notNull().default(1),
  createdAt: createdAt(),
});

export const blackouts = pgTable('blackouts', {
  id: id(),
  tenantId: tenantRef(),
  day: date('day').notNull(),
  reason: text('reason').notNull().default(''),
}, (t) => [uniqueIndex('blackouts_uq').on(t.tenantId, t.day)]);

export const deliveryZones = pgTable('delivery_zones', {
  id: id(),
  tenantId: tenantRef(),
  name: text('name').notNull(),
  zips: jsonb('zips').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Optional radius from base, in miles (used when lat/lng is known). */
  radiusMiles: doublePrecision('radius_miles'),
  feeCents: integer('fee_cents').notNull().default(0),
  minOrderCents: integer('min_order_cents').notNull().default(0),
  sort: integer('sort').notNull().default(0),
});

/* ───────────────────────── CRM & bookings ───────────────────────── */

export const customers = pgTable('customers', {
  id: id(),
  tenantId: tenantRef(),
  email: text('email').notNull(),
  name: text('name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  /** Kid birthday month/day captured at checkout → birthday re-book campaigns. */
  celebrantName: text('celebrant_name'),
  celebrantBirthday: date('celebrant_birthday'),
  organization: text('organization'),
  type: text('type').$type<'residential' | 'school' | 'church' | 'corporate' | 'municipal' | 'nonprofit'>().notNull().default('residential'),
  tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  source: text('source').notNull().default('website'),
  marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
  smsOptIn: boolean('sms_opt_in').notNull().default(false),
  lifetimeValueCents: integer('lifetime_value_cents').notNull().default(0),
  notes: text('notes').notNull().default(''),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('customers_email_uq').on(t.tenantId, sql`lower(${t.email})`)]);

export type BookingStatus = 'hold' | 'quote' | 'pending' | 'confirmed' | 'completed' | 'canceled';

export const bookings = pgTable('bookings', {
  id: id(),
  tenantId: tenantRef(),
  number: integer('number').notNull(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  status: text('status').$type<BookingStatus>().notNull().default('hold'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
  /** Event location */
  address: text('address').notNull().default(''),
  city: text('city').notNull().default(''),
  state: text('state').notNull().default(''),
  zip: text('zip').notNull().default(''),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  surface: text('surface').notNull().default('grass'),
  eventType: text('event_type').notNull().default('birthday'),
  notes: text('notes').notNull().default(''),
  /** Money (cents) — snapshot at booking time */
  subtotalCents: integer('subtotal_cents').notNull().default(0),
  deliveryCents: integer('delivery_cents').notNull().default(0),
  surfaceCents: integer('surface_cents').notNull().default(0),
  damageWaiverCents: integer('damage_waiver_cents').notNull().default(0),
  discountCents: integer('discount_cents').notNull().default(0),
  taxCents: integer('tax_cents').notNull().default(0),
  platformFeeCents: integer('platform_fee_cents').notNull().default(0),
  customerFeeCents: integer('customer_fee_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull().default(0),
  depositCents: integer('deposit_cents').notNull().default(0),
  paidCents: integer('paid_cents').notNull().default(0),
  couponCode: text('coupon_code'),
  /** E-signature of the rental agreement */
  agreementSignedName: text('agreement_signed_name'),
  agreementSignedAt: timestamp('agreement_signed_at', { withTimezone: true }),
  agreementSignedIp: text('agreement_signed_ip'),
  agreementHash: text('agreement_hash'),
  /** Attribution — UTM, referrer, marketplace lead */
  attribution: jsonb('attribution').$type<Attribution>().notNull().default(sql`'{}'::jsonb`),
  leadId: uuid('lead_id'),
  /** Fulfilment */
  crewUserId: uuid('crew_user_id'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
  checklist: jsonb('checklist').$type<Record<string, boolean>>().notNull().default(sql`'{}'::jsonb`),
  reviewRequestedAt: timestamp('review_requested_at', { withTimezone: true }),
  publicToken: text('public_token').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('bookings_number_uq').on(t.tenantId, t.number),
  uniqueIndex('bookings_token_uq').on(t.publicToken),
  index('bookings_window_idx').on(t.tenantId, t.startsAt, t.endsAt),
]);

export interface Attribution {
  utmSource?: string; utmMedium?: string; utmCampaign?: string; utmTerm?: string; utmContent?: string;
  gclid?: string; fbclid?: string; referrer?: string; landingPage?: string;
  channel?: 'organic' | 'paid_search' | 'paid_social' | 'social' | 'email' | 'sms' | 'referral' | 'marketplace' | 'direct' | 'partner';
}

export const bookingLines = pgTable('booking_lines', {
  id: id(),
  tenantId: tenantRef(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  qty: integer('qty').notNull().default(1),
  unitCents: integer('unit_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
}, (t) => [index('booking_lines_booking_idx').on(t.bookingId), index('booking_lines_item_idx').on(t.itemId)]);

export const payments = pgTable('payments', {
  id: id(),
  tenantId: tenantRef(),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  provider: text('provider').$type<'stripe' | 'demo' | 'cash' | 'check' | 'other'>().notNull(),
  providerRef: text('provider_ref'),
  amountCents: integer('amount_cents').notNull(),
  applicationFeeCents: integer('application_fee_cents').notNull().default(0),
  status: text('status').$type<'pending' | 'succeeded' | 'failed' | 'refunded'>().notNull().default('pending'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('payments_ref_uq').on(t.providerRef)]);

export const coupons = pgTable('coupons', {
  id: id(),
  tenantId: tenantRef(),
  code: text('code').notNull(),
  percentOff: integer('percent_off'),
  amountOffCents: integer('amount_off_cents'),
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
}, (t) => [uniqueIndex('coupons_code_uq').on(t.tenantId, sql`upper(${t.code})`)]);

/** Abandoned checkouts + inbound quote requests. */
export const leads = pgTable('leads', {
  id: id(),
  tenantId: tenantRef(),
  email: text('email').notNull().default(''),
  name: text('name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  eventDate: date('event_date'),
  zip: text('zip').notNull().default(''),
  message: text('message').notNull().default(''),
  cart: jsonb('cart').$type<{ itemId: string; qty: number }[]>().notNull().default(sql`'[]'::jsonb`),
  stage: text('stage').$type<'new' | 'contacted' | 'quoted' | 'won' | 'lost'>().notNull().default('new'),
  source: text('source').$type<'abandoned_checkout' | 'quote_form' | 'marketplace' | 'phone' | 'partner'>().notNull().default('quote_form'),
  marketplaceLeadId: uuid('marketplace_lead_id'),
  followUpsSent: integer('follow_ups_sent').notNull().default(0),
  lastFollowUpAt: timestamp('last_follow_up_at', { withTimezone: true }),
  attribution: jsonb('attribution').$type<Attribution>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, (t) => [index('leads_tenant_idx').on(t.tenantId, t.createdAt)]);

/* ───────────────────────── Website CMS ───────────────────────── */

export interface ThemeTokens {
  preset: string;
  primary: string; primaryInk: string;
  accent: string; accentInk: string;
  ink: string; paper: string; muted: string;
  fontDisplay: string; fontBody: string;
  radius: 'soft' | 'round' | 'pill';
}

export const sites = pgTable('sites', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  theme: jsonb('theme').$type<ThemeTokens>().notNull(),
  nav: jsonb('nav').$type<{ label: string; href: string }[]>().notNull().default(sql`'[]'::jsonb`),
  announcement: text('announcement'),
  footerBlurb: text('footer_blurb').notNull().default(''),
  /** Global SEO */
  titleTemplate: text('title_template').notNull().default('%s | {business}'),
  defaultDescription: text('default_description').notNull().default(''),
  ogImage: text('og_image'),
  published: boolean('published').notNull().default(true),
  updatedAt: updatedAt(),
});

export interface Block { id: string; type: string; props: Record<string, unknown>; }

export const pages = pgTable('pages', {
  id: id(),
  tenantId: tenantRef(),
  slug: text('slug').notNull(),            // '' = home
  kind: text('kind').$type<'page' | 'city' | 'post' | 'landing'>().notNull().default('page'),
  title: text('title').notNull(),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  blocks: jsonb('blocks').$type<Block[]>().notNull().default(sql`'[]'::jsonb`),
  /** City pages: structured local facts that make each page unique. */
  local: jsonb('local').$type<LocalFacts>(),
  status: text('status').$type<'draft' | 'published'>().notNull().default('published'),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('pages_slug_uq').on(t.tenantId, t.kind, t.slug)]);

export interface LocalFacts {
  city: string; state: string; zips?: string[];
  neighborhoods?: string[]; parks?: string[]; venues?: string[];
  intro?: string; deliveryNote?: string; lat?: number; lng?: number;
  faqs?: { q: string; a: string }[];
}

export const reviews = pgTable('reviews', {
  id: id(),
  tenantId: tenantRef(),
  author: text('author').notNull(),
  rating: integer('rating').notNull(),
  body: text('body').notNull().default(''),
  source: text('source').$type<'google' | 'facebook' | 'yelp' | 'direct'>().notNull().default('direct'),
  bookingId: uuid('booking_id'),
  featured: boolean('featured').notNull().default(true),
  createdAt: createdAt(),
});

export const media = pgTable('media', {
  id: id(),
  tenantId: tenantRef(),
  url: text('url').notNull(),
  alt: text('alt').notNull().default(''),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull().default(0),
  createdAt: createdAt(),
});

/* ───────────────────────── Marketing ───────────────────────── */

export const campaigns = pgTable('campaigns', {
  id: id(),
  tenantId: tenantRef(),
  name: text('name').notNull(),
  channel: text('channel').$type<'email' | 'sms'>().notNull(),
  kind: text('kind').$type<'broadcast' | 'birthday' | 'rebook' | 'review' | 'abandoned' | 'seasonal'>().notNull().default('broadcast'),
  segment: jsonb('segment').$type<{ type?: string; tag?: string; bookedWithinDays?: number; notBookedDays?: number }>().notNull().default(sql`'{}'::jsonb`),
  subject: text('subject').notNull().default(''),
  body: text('body').notNull().default(''),
  status: text('status').$type<'draft' | 'scheduled' | 'sending' | 'sent' | 'automated'>().notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  sentCount: integer('sent_count').notNull().default(0),
  openCount: integer('open_count').notNull().default(0),
  clickCount: integer('click_count').notNull().default(0),
  bookingsAttributed: integer('bookings_attributed').notNull().default(0),
  createdAt: createdAt(),
});

export const messages = pgTable('messages', {
  id: id(),
  tenantId: tenantRef(),
  campaignId: uuid('campaign_id'),
  customerId: uuid('customer_id'),
  bookingId: uuid('booking_id'),
  channel: text('channel').$type<'email' | 'sms'>().notNull(),
  to: text('to').notNull(),
  subject: text('subject').notNull().default(''),
  body: text('body').notNull(),
  status: text('status').$type<'queued' | 'sent' | 'failed' | 'logged'>().notNull().default('queued'),
  providerRef: text('provider_ref'),
  error: text('error'),
  createdAt: createdAt(),
}, (t) => [index('messages_tenant_idx').on(t.tenantId, t.createdAt)]);

export const socialPosts = pgTable('social_posts', {
  id: id(),
  tenantId: tenantRef(),
  networks: jsonb('networks').$type<('facebook' | 'instagram' | 'gbp' | 'tiktok')[]>().notNull(),
  caption: text('caption').notNull(),
  imageUrl: text('image_url'),
  itemId: uuid('item_id'),
  link: text('link'),
  status: text('status').$type<'draft' | 'scheduled' | 'published' | 'failed'>().notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  result: jsonb('result').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const adCampaigns = pgTable('ad_campaigns', {
  id: id(),
  tenantId: tenantRef(),
  network: text('network').$type<'google' | 'meta'>().notNull(),
  name: text('name').notNull(),
  objective: text('objective').notNull().default('bookings'),
  cities: jsonb('cities').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Generated, policy-checked creative: ad groups / headlines / descriptions / keywords. */
  creative: jsonb('creative').$type<AdCreative>().notNull(),
  dailyBudgetCents: integer('daily_budget_cents').notNull().default(2000),
  managed: boolean('managed').notNull().default(false),   // Branch Avenue managed service
  status: text('status').$type<'draft' | 'pending_launch' | 'live' | 'paused' | 'ended'>().notNull().default('draft'),
  spendCents: integer('spend_cents').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
  impressions: integer('impressions').notNull().default(0),
  conversions: integer('conversions').notNull().default(0),
  createdAt: createdAt(),
});

export interface AdCreative {
  adGroups: {
    name: string; keywords: string[]; negativeKeywords?: string[];
    headlines: string[]; descriptions: string[]; finalUrl: string;
  }[];
  primaryText?: string[]; // meta
}

/* ───────────────────────── Revenue share & marketplace ───────────────────────── */

/**
 * Immutable ledger of every revenue-share event. Amounts in cents.
 *  platform_fee     — Branch Avenue % of a booking payment
 *  subscription     — operator SaaS subscription charge
 *  referral_commission — recurring commission owed to the referring operator
 *  marketplace_lead_fee — fee for a marketplace lead that converted
 *  partner_referral — operator→operator overflow share
 *  ads_management_fee — % of managed ad spend
 */
export const revenueEvents = pgTable('revenue_events', {
  id: id(),
  kind: text('kind').$type<'platform_fee' | 'subscription' | 'referral_commission' | 'marketplace_lead_fee' | 'partner_referral' | 'ads_management_fee'>().notNull(),
  /** The tenant the money relates to (payer side). */
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  /** Beneficiary tenant (referrer / partner). Null = Branch Avenue. */
  beneficiaryTenantId: uuid('beneficiary_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  amountCents: integer('amount_cents').notNull(),
  bookingId: uuid('booking_id'),
  sourceRef: text('source_ref'),
  status: text('status').$type<'accrued' | 'payable' | 'paid' | 'void'>().notNull().default('accrued'),
  memo: text('memo').notNull().default(''),
  createdAt: createdAt(),
}, (t) => [index('rev_kind_idx').on(t.kind, t.createdAt), uniqueIndex('rev_source_uq').on(t.kind, t.sourceRef)]);

/** Consumer requests from the BounceOS marketplace (/find) routed to operators. */
export const marketplaceLeads = pgTable('marketplace_leads', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull().default(''),
  zip: text('zip').notNull(),
  eventDate: date('event_date').notNull(),
  guests: integer('guests'),
  wants: jsonb('wants').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  message: text('message').notNull().default(''),
  routedTenantIds: jsonb('routed_tenant_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  wonByTenantId: uuid('won_by_tenant_id'),
  createdAt: createdAt(),
});

/** Operator ↔ operator overflow partnerships. */
export const partnerships = pgTable('partnerships', {
  id: id(),
  fromTenantId: uuid('from_tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  toTenantId: uuid('to_tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  shareBps: integer('share_bps').notNull().default(1000),   // 10% of referred booking to sender
  status: text('status').$type<'pending' | 'active' | 'declined'>().notNull().default('pending'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('partnerships_uq').on(t.fromTenantId, t.toTenantId)]);

/* ───────────────────────── Engagement / fun ───────────────────────── */

export const achievements = pgTable('achievements', {
  tenantId: tenantRef(),
  key: text('key').notNull(),
  unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.key] })]);

export const activity = pgTable('activity', {
  id: id(),
  tenantId: tenantRef(),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index('activity_tenant_idx').on(t.tenantId, t.createdAt)]);
