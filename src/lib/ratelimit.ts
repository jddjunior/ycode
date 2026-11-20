/** In-process token bucket. For multi-instance deploys, back the same API with Redis. */
const buckets = new Map<string, { tokens: number; at: number }>();

export function rateLimit(key: string, capacity: number, refillPerMin: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 60_000) * refillPerMin);
  b.at = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 50_000) for (const [k, v] of buckets) if (now - v.at > 600_000) buckets.delete(k);
  return true;
}
