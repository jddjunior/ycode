/**
 * First-party attribution: the storefront layout writes a `bos_attr` cookie
 * (UTM / gclid / fbclid / referrer / landing page). The booking + lead APIs
 * read it here and classify the channel.
 */
import type { AstroCookies } from 'astro';
import type { Attribution } from '../../db/schema';

export const ATTR_COOKIE = 'bos_attr';

const clip = (v: unknown, n = 200) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);

export function classify(a: Attribution): NonNullable<Attribution['channel']> {
  const src = (a.utmSource ?? '').toLowerCase();
  const med = (a.utmMedium ?? '').toLowerCase();
  const ref = (a.referrer ?? '').toLowerCase();
  if (src.startsWith('partner:')) return 'partner';
  if (src === 'bounceos' || src === 'marketplace' || med === 'marketplace') return 'marketplace';
  const paid = /^(cpc|ppc|paid|paidsearch|paid_search|cpm|display|paid_social|paidsocial)$/.test(med);
  const socialSrc = /facebook|instagram|meta|fb|ig|tiktok|pinterest|nextdoor/.test(src);
  if (a.gclid || (paid && !socialSrc)) return 'paid_search';
  if (paid && socialSrc) return 'paid_social';
  if (med === 'email' || src === 'email') return 'email';
  if (med === 'sms' || src === 'sms') return 'sms';
  if (a.fbclid || socialSrc || med === 'social') return 'social';
  if (/google\.|bing\.|duckduckgo\.|yahoo\.|ecosia\.|search\.brave/.test(ref)) return 'organic';
  if (/facebook\.|instagram\.|tiktok\.|pinterest\.|nextdoor\.|t\.co\b|x\.com/.test(ref)) return 'social';
  if (ref) return 'referral';
  if (src) return 'referral';
  return 'direct';
}

export function readAttribution(cookies: AstroCookies): Attribution {
  const raw = cookies.get(ATTR_COOKIE)?.value;
  let j: Record<string, unknown> = {};
  if (raw) {
    try { j = JSON.parse(raw.startsWith('%7B') || raw.startsWith('%7b') ? decodeURIComponent(raw) : raw); } catch { j = {}; }
  }
  const a: Attribution = {
    utmSource: clip(j.utm_source), utmMedium: clip(j.utm_medium), utmCampaign: clip(j.utm_campaign),
    utmTerm: clip(j.utm_term), utmContent: clip(j.utm_content), gclid: clip(j.gclid), fbclid: clip(j.fbclid),
    referrer: clip(j.ref, 500), landingPage: clip(j.lp, 500),
  };
  for (const k of Object.keys(a) as (keyof Attribution)[]) if (a[k] === undefined) delete a[k];
  a.channel = classify(a);
  return a;
}
