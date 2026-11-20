/**
 * BounceOS plans. Flat pricing, no per-item or per-seat creep (the #1
 * complaint about incumbents — docs/research/01-competitor-software.md).
 * Platform fee benchmarks: Goodshuffle 0.25%, BRS 0.35%, RentKit 0.6%.
 * Pricing positions under Inflatable Office/Goodshuffle on
 * entry while monetising through transparent platform fees and growth
 * services (see docs/research for the competitive rationale).
 */
import type { PlanId } from '../db/schema';

export interface Plan {
  id: PlanId;
  name: string;
  monthlyCents: number;
  platformFeeBps: number;       // Branch Avenue fee on online booking payments
  adsManagementBps: number;     // fee on managed ad spend
  referralCommissionBps: number; // what a referrer earns from this plan's subscription
  limits: { items: number | null; cityPages: number | null; users: number | null; aiCredits: number };
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter', name: 'Starter', monthlyCents: 4900, platformFeeBps: 90, adsManagementBps: 1500, referralCommissionBps: 2000,
    limits: { items: null, cityPages: 10, users: 3, aiCredits: 100 },
    features: ['SEO storefront website + custom domain', 'Real-time online booking & deposits', 'E-sign rental agreements', 'Delivery zones & route planner', '10 city landing pages', 'Unlimited inventory — never priced per item', 'Review requests', 'Marketplace listing'],
  },
  pro: {
    id: 'pro', name: 'Pro', monthlyCents: 12900, platformFeeBps: 60, adsManagementBps: 1200, referralCommissionBps: 2000,
    limits: { items: null, cityPages: 30, users: 8, aiCredits: 1000 },
    features: ['Everything in Starter', '30 city pages + blog', 'Email & SMS campaigns + birthday re-book automation', 'AI social studio & scheduler', 'Google & Meta ad builder', 'Crew app & checklists', 'Partner overflow network'],
  },
  elite: {
    id: 'elite', name: 'Elite', monthlyCents: 29900, platformFeeBps: 40, adsManagementBps: 1000, referralCommissionBps: 2000,
    limits: { items: null, cityPages: null, users: null, aiCredits: 5000 },
    features: ['Everything in Pro', 'Unlimited city pages & users', 'Multi-location', 'Managed ads by Branch Avenue', 'Priority marketplace placement', 'Dedicated growth strategist'],
  },
};

export const planList = () => Object.values(PLANS);

/** Marketplace fee: charged only on bookings the BounceOS marketplace originated. */
export const MARKETPLACE_FEE_BPS = 1000;
/** Default operator→operator overflow share. */
export const PARTNER_SHARE_BPS = 1000;
/** Referral commission duration (months of referred subscription). */
export const REFERRAL_MONTHS = 12;
