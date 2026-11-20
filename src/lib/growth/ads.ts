/**
 * Ad campaign builder + Google Ads Editor CSV export.
 * Search-only by design (research: GBP "advertise" Smart campaigns waste budget on display).
 */
import { generateSearchAd, generateMetaPrimaryText, NEGATIVES } from '../ai';
import type { AdCreative } from '../../db/schema';

export const HEADLINE_MAX = 30;
export const DESCRIPTION_MAX = 90;
export const PRIMARY_MAX = 220;

export interface BuildInput {
  network: 'google' | 'meta';
  business: string; state: string; origin: string; campaignKey: string;
  cities: string[]; categories: { name: string; slug: string }[]; usps: string[];
}

export function finalUrl(origin: string, path: string, network: string, campaignKey: string) {
  const q = new URLSearchParams({ utm_source: network === 'google' ? 'google' : 'facebook', utm_medium: network === 'google' ? 'cpc' : 'paid_social', utm_campaign: campaignKey });
  return `${origin}${path}?${q}`;
}

/** One ad group per city × category (Google) or a single creative set (Meta). */
export async function buildCreative(i: BuildInput): Promise<AdCreative> {
  const groups: AdCreative['adGroups'] = [];
  for (const city of i.cities) {
    for (const cat of i.categories) {
      const url = finalUrl(i.origin, `/rentals/${cat.slug}`, i.network, i.campaignKey);
      const g = await generateSearchAd({ business: i.business, city, state: i.state, category: cat.name, finalUrl: url, usps: i.usps });
      groups.push(i.network === 'google' ? g : { ...g, keywords: [], negativeKeywords: [] });
      if (groups.length >= 40) break;
    }
  }
  if (i.network === 'meta') {
    const first = i.categories[0] ?? { name: 'Bounce Houses', slug: 'bounce-houses' };
    const primaryText = await generateMetaPrimaryText({ business: i.business, city: i.cities.join(', '), state: i.state, category: first.name, finalUrl: groups[0]?.finalUrl ?? i.origin, usps: i.usps });
    return { adGroups: groups.slice(0, 10), primaryText };
  }
  return { adGroups: groups };
}

export interface CreativeIssue { group: number; field: string; message: string }

export function validateCreative(c: AdCreative, network: 'google' | 'meta'): CreativeIssue[] {
  const out: CreativeIssue[] = [];
  c.adGroups.forEach((g, gi) => {
    g.headlines.forEach((h, i) => { if (h.length > HEADLINE_MAX) out.push({ group: gi, field: `Headline ${i + 1}`, message: `${h.length}/${HEADLINE_MAX} characters` }); });
    g.descriptions.forEach((d, i) => { if (d.length > DESCRIPTION_MAX) out.push({ group: gi, field: `Description ${i + 1}`, message: `${d.length}/${DESCRIPTION_MAX} characters` }); });
    if (network === 'google') {
      if (g.headlines.length < 3) out.push({ group: gi, field: 'Headlines', message: 'Responsive search ads need at least 3 headlines' });
      if (g.descriptions.length < 2) out.push({ group: gi, field: 'Descriptions', message: 'Responsive search ads need at least 2 descriptions' });
      if (!g.keywords.length) out.push({ group: gi, field: 'Keywords', message: 'Add at least one keyword' });
    }
    if (!/^https?:\/\//.test(g.finalUrl)) out.push({ group: gi, field: 'Final URL', message: 'Must be a full URL' });
  });
  (c.primaryText ?? []).forEach((p, i) => { if (p.length > PRIMARY_MAX) out.push({ group: -1, field: `Primary text ${i + 1}`, message: `${p.length}/${PRIMARY_MAX} characters` }); });
  return out;
}

/** "[kw]" → Exact, "\"kw\"" → Phrase, else Broad. */
export function matchType(k: string): { text: string; type: 'Exact' | 'Phrase' | 'Broad' } {
  const s = k.trim();
  if (s.startsWith('[') && s.endsWith(']')) return { text: s.slice(1, -1), type: 'Exact' };
  if (s.startsWith('"') && s.endsWith('"')) return { text: s.slice(1, -1), type: 'Phrase' };
  return { text: s, type: 'Broad' };
}

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Google Ads Editor import CSV (Account → Import → From file). */
export function googleAdsEditorCsv(c: { name: string; dailyBudgetCents: number; creative: AdCreative }): string {
  const H = Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`);
  const D = Array.from({ length: 4 }, (_, i) => `Description ${i + 1}`);
  const cols = ['Campaign', 'Campaign Type', 'Networks', 'Budget', 'Budget type', 'Campaign Status', 'Ad Group', 'Ad Group Status', 'Keyword', 'Criterion Type', 'Ad type', ...H, ...D, 'Final URL', 'Status'];
  const rows: Record<string, string | number>[] = [];
  rows.push({ Campaign: c.name, 'Campaign Type': 'Search', Networks: 'Google search', Budget: (c.dailyBudgetCents / 100).toFixed(2), 'Budget type': 'Daily', 'Campaign Status': 'Paused' });
  for (const g of c.creative.adGroups) {
    rows.push({ Campaign: c.name, 'Ad Group': g.name, 'Ad Group Status': 'Enabled' });
    for (const k of g.keywords) { const m = matchType(k); rows.push({ Campaign: c.name, 'Ad Group': g.name, Keyword: m.text, 'Criterion Type': m.type, Status: 'Enabled' }); }
    for (const k of g.negativeKeywords ?? NEGATIVES) rows.push({ Campaign: c.name, 'Ad Group': g.name, Keyword: matchType(k).text, 'Criterion Type': 'Negative Phrase' });
    const ad: Record<string, string | number> = { Campaign: c.name, 'Ad Group': g.name, 'Ad type': 'Responsive search ad', 'Final URL': g.finalUrl, Status: 'Enabled' };
    g.headlines.slice(0, 15).forEach((h, i) => (ad[H[i]] = h));
    g.descriptions.slice(0, 4).forEach((d, i) => (ad[D[i]] = d));
    rows.push(ad);
  }
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((k) => cell(r[k] ?? '')).join(','))].join('\r\n') + '\r\n';
}
