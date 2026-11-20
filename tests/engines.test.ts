import { describe, it, expect } from 'vitest';
import { freeUnits, checkCart, explode, peakUsage, type InvItem } from '../src/lib/availability';
import { quote, unitPrice } from '../src/lib/pricing';
import { matchZone, planRoute, haversineMiles } from '../src/lib/geo';
import { zonedToUtc, localDay } from '../src/lib/time';
import { fit, policyOk, keywordsFor } from '../src/lib/ai';
import { scorePage } from '../src/lib/seo';
import { assessRisk } from '../src/lib/weather';
import { miniMarkdown, slugify, jsonLd } from '../src/lib/util';
import { themeCss } from '../src/lib/themes';

const H = 3_600_000;
const t0 = Date.UTC(2027, 5, 12, 15);
const win = (h0: number, h1: number) => ({ startsAt: new Date(t0 + h0 * H), endsAt: new Date(t0 + h1 * H) });

const items: InvItem[] = [
  { id: 'castle', quantity: 2, setupMinutes: 60, teardownMinutes: 60 },
  { id: 'slide', quantity: 1, setupMinutes: 60, teardownMinutes: 60 },
  { id: 'candy', quantity: 3, setupMinutes: 0, teardownMinutes: 0, kind: 'addon' },
  { id: 'pkg', quantity: 1, setupMinutes: 0, teardownMinutes: 0, kind: 'package', bundle: [{ itemId: 'castle', qty: 1 }, { itemId: 'candy', qty: 1 }] },
];

describe('availability', () => {
  it('counts overlapping reservations including buffers', () => {
    const res = [{ itemId: 'castle', qty: 1, ...win(0, 6) }];
    expect(freeUnits(items, res, [], win(2, 4)).get('castle')).toBe(1);
    // ends at +6h, +1h teardown, new one starts +8h with 1h setup → touching, no overlap
    expect(freeUnits(items, res, [], win(8, 10)).get('castle')).toBe(2);
    // starts +7h: setup begins +6h while teardown runs to +7h → overlap
    expect(freeUnits(items, res, [], win(7, 10)).get('castle')).toBe(1);
  });
  it('blocks the last unit and reports conflicts', () => {
    const res = [{ itemId: 'slide', qty: 1, ...win(0, 6) }];
    expect(checkCart(items, res, [], win(1, 5), [{ itemId: 'slide', qty: 1 }])).toEqual([{ itemId: 'slide', requested: 1, free: 0 }]);
    expect(checkCart(items, res, [], win(1, 5), [{ itemId: 'castle', qty: 2 }])).toEqual([]);
  });
  it('packages consume components and derive their own availability', () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(explode([{ itemId: 'pkg', qty: 2 }], byId)).toEqual([{ itemId: 'castle', qty: 2 }, { itemId: 'candy', qty: 2 }]);
    const res = [{ itemId: 'castle', qty: 2, ...win(0, 6) }];
    expect(freeUnits(items, res, [], win(1, 5)).get('pkg')).toBe(0);
    expect(checkCart(items, [], [], win(1, 5), [{ itemId: 'pkg', qty: 1 }, { itemId: 'castle', qty: 1 }])).toEqual([]);
    expect(checkCart(items, [], [], win(1, 5), [{ itemId: 'pkg', qty: 1 }, { itemId: 'castle', qty: 2 }])).toHaveLength(1);
  });
  it('respects out-of-service units and inactive items', () => {
    expect(freeUnits(items, [], [{ itemId: 'castle', units: 1, from: new Date(t0 - 10 * H), until: null }], win(0, 4)).get('castle')).toBe(1);
    expect(freeUnits([{ ...items[0], active: false }], [], [], win(0, 4)).get('castle')).toBe(0);
  });
  it('peak usage is the max concurrency, not the sum', () => {
    expect(peakUsage([{ s: 0, e: 10, q: 1 }, { s: 20, e: 30, q: 1 }], 0, 30)).toBe(1);
    expect(peakUsage([{ s: 0, e: 10, q: 1 }, { s: 5, e: 30, q: 1 }], 0, 30)).toBe(2);
  });
});

describe('pricing', () => {
  const pi = [{ id: 'castle', name: 'Castle', priceCents: 17500, baseHours: 8, extraHourCents: 1500, overnightCents: 22500 }];
  it('charges extra hours and overnight', () => {
    expect(unitPrice(pi[0], 6)).toBe(17500);
    expect(unitPrice(pi[0], 9.5)).toBe(17500 + 2 * 1500);
    expect(unitPrice(pi[0], 24, true)).toBe(22500);
  });
  it('builds a receipt that sums exactly', () => {
    const q = quote({ lines: [{ itemId: 'castle', qty: 2 }], items: pi, hours: 6, deliveryCents: 3500, surfaceCents: 2500, damageWaiver: true,
      coupon: { amountOffCents: 2500 }, settings: { taxRateBps: 825, damageWaiverBps: 800, depositType: 'percent', depositValue: 25 }, plan: 'pro' });
    expect(q.subtotalCents).toBe(35000);
    expect(q.discountCents).toBe(2500);
    expect(q.damageWaiverCents).toBe(2600);
    const sum = q.subtotalCents - q.discountCents + q.deliveryCents + q.surfaceCents + q.damageWaiverCents + q.taxCents + q.customerFeeCents;
    expect(q.totalCents).toBe(sum);
    expect(q.platformFeeCents).toBe(Math.round(q.totalCents * 0.006));
    expect(q.depositCents).toBe(Math.round(q.totalCents * 0.25));
    expect(q.operatorNetCents).toBe(q.totalCents - q.platformFeeCents);
  });
  it('passes the platform fee through when configured', () => {
    const q = quote({ lines: [{ itemId: 'castle', qty: 1 }], items: pi, hours: 4, deliveryCents: 0, settings: { passPlatformFeeToCustomer: true, depositType: 'full' }, plan: 'starter' });
    expect(q.customerFeeCents).toBe(q.platformFeeCents);
    expect(q.depositCents).toBe(q.totalCents);
  });
});

describe('geo', () => {
  const zones = [
    { id: 'a', name: 'Local', zips: ['77008'], radiusMiles: 10, feeCents: 0, minOrderCents: 0, sort: 0 },
    { id: 'b', name: 'Far', zips: [], radiusMiles: 30, feeCents: 4500, minOrderCents: 0, sort: 1 },
  ];
  const base = { lat: 29.8, lng: -95.41 };
  it('matches by ZIP then radius', () => {
    expect(matchZone(zones, '77008')?.id).toBe('a');
    expect(matchZone(zones, '77494', { lat: 29.74, lng: -95.83 }, base)?.id).toBe('b');
    expect(matchZone(zones, '75001', { lat: 32.96, lng: -96.83 }, base)).toBeNull();
  });
  it('haversine is sane', () => { expect(haversineMiles({ lat: 29.76, lng: -95.37 }, { lat: 30.27, lng: -97.74 })).toBeGreaterThan(140); });
  it('route keeps deadlines and is no longer than the seed', () => {
    const stops = [
      { id: '1', lat: 29.74, lng: -95.83, dueBy: t0 + 4 * H },
      { id: '2', lat: 29.79, lng: -95.37, dueBy: t0 + 2 * H },
      { id: '3', lat: 29.58, lng: -95.62, dueBy: t0 + 4 * H },
    ];
    const r = planRoute(base, stops, { startAt: t0 });
    expect(r.order[0].id).toBe('2');
    expect(r.order).toHaveLength(3);
    expect(r.late).toBe(0);
  });
});

describe('time', () => {
  it('converts wall clock across DST', () => {
    expect(zonedToUtc('2027-06-12', 10, 0, 'America/Chicago').toISOString()).toBe('2027-06-12T15:00:00.000Z');
    expect(zonedToUtc('2027-01-12', 10, 0, 'America/Chicago').toISOString()).toBe('2027-01-12T16:00:00.000Z');
    expect(localDay(new Date('2027-06-13T03:00:00Z'), 'America/Chicago')).toBe('2027-06-12');
  });
});

describe('copy + seo + safety', () => {
  it('fits ad text to limits on word boundaries', () => {
    const s = fit('Bounce House Rentals in Houston Texas Today', 30);
    expect(s.length).toBeLessThanOrEqual(30);
    expect(s.endsWith(' ')).toBe(false);
  });
  it('rejects banned claims', () => { expect(policyOk('Guaranteed cheapest!!')).toBe(false); expect(policyOk('Book online today')).toBe(true); });
  it('builds exact + phrase keywords', () => { expect(keywordsFor('Water Slides', 'Katy')).toContain('[water slide rental katy]'); });
  it('scores pages', () => {
    const good = scorePage({ title: 'Bounce House Rentals in Katy, TX | Bounce Brigade', description: 'x'.repeat(140), h1: 'Bounce house rentals in Katy', bodyText: 'word '.repeat(320), hasSchema: true, images: [{ alt: 'castle bounce house' }], internalLinks: 5, keyword: 'bounce house rentals', city: 'Katy' });
    expect(good.score).toBe(100);
    expect(scorePage({ title: 'Home', description: '', h1: '', bodyText: '', hasSchema: false, images: [], internalLinks: 0 }).score).toBeLessThanOrEqual(30);
  });
  it('weather risk levels', () => {
    expect(assessRisk('d', 22, 30, 0, 80, 20).level).toBe('stop');
    expect(assessRisk('d', 16, 18, 0, 80, 20).level).toBe('watch');
    expect(assessRisk('d', 5, 8, 10, 80, 20).level).toBe('ok');
  });
  it('escapes user content', () => {
    expect(miniMarkdown('<script>alert(1)</script> **hi**')).not.toContain('<script>');
    expect(miniMarkdown('[x](javascript:alert(1))')).not.toContain('href="javascript');
    expect(jsonLd({ a: '</script>' })).not.toContain('</script>');
    expect(slugify('Kids & Teens Water Slide!')).toBe('kids-and-teens-water-slide');
    expect(themeCss({ preset: 'carnival', primary: 'red;}body{x', primaryInk: '#fff', accent: '#000000', accentInk: '#FFFFFF', ink: '#000000', paper: '#FFFFFF', muted: '#EEEEEE', fontDisplay: 'x', fontBody: 'y', radius: 'round' })).not.toContain('body{');
  });
});
