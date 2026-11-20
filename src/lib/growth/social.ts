/**
 * Social publishing adapters.
 *
 * Tokens are NEVER stored in the database. Each adapter reads an access token
 * from the environment, keyed by tenant slug (secrets manager → env), e.g.
 *   SOCIAL_META_TOKEN_BOUNCE_BRIGADE   Page access token (Facebook Page + linked Instagram)
 *   SOCIAL_GBP_TOKEN_BOUNCE_BRIGADE    OAuth access token for the Business Profile API
 * Public IDs come from tenants.integrations (facebookPageId, gbpLocationId) plus
 * SOCIAL_IG_USER_<SLUG> for the Instagram Business account id (not in the schema yet).
 * With no token, a network is "manual": the operator copies the caption and
 * clicks "Mark as posted". TikTok has no organic posting adapter (manual only).
 */
import type { Tenant } from '../auth';
import { platformUrl } from '../tenant';
import type { schema } from '../../db/client';

export type Network = 'facebook' | 'instagram' | 'gbp' | 'tiktok';
export const NETWORKS: { key: Network; label: string }[] = [
  { key: 'facebook', label: 'Facebook' }, { key: 'instagram', label: 'Instagram' }, { key: 'gbp', label: 'Google Business Profile' }, { key: 'tiktok', label: 'TikTok' },
];
type Post = typeof schema.socialPosts.$inferSelect;

export interface PublishResult { ok: boolean; id?: string; error?: string; manual?: boolean }
export interface SocialAdapter {
  network: Network;
  /** True when a token + public id are configured for this tenant. */
  connected(t: Tenant): boolean;
  publish(t: Tenant, post: Post, absoluteImage: string | null): Promise<PublishResult>;
}

const envKey = (prefix: string, t: Tenant) => `${prefix}_${t.slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
const env = (prefix: string, t: Tenant) => process.env[envKey(prefix, t)] ?? '';
const GRAPH = 'https://graph.facebook.com/v21.0';

async function postJson(url: string, body: Record<string, unknown>, token: string, bearer = false): Promise<PublishResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(bearer ? body : { ...body, access_token: token }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: j.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, id: j.id ?? j.name };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

const facebook: SocialAdapter = {
  network: 'facebook',
  connected: (t) => !!(env('SOCIAL_META_TOKEN', t) && t.integrations.facebookPageId),
  async publish(t, post, image) {
    const token = env('SOCIAL_META_TOKEN', t), page = t.integrations.facebookPageId!;
    return image
      ? postJson(`${GRAPH}/${encodeURIComponent(page)}/photos`, { url: image, caption: post.caption + (post.link ? `\n${post.link}` : '') }, token)
      : postJson(`${GRAPH}/${encodeURIComponent(page)}/feed`, { message: post.caption, link: post.link ?? undefined }, token);
  },
};

const instagram: SocialAdapter = {
  network: 'instagram',
  connected: (t) => !!(env('SOCIAL_META_TOKEN', t) && env('SOCIAL_IG_USER', t)),
  async publish(t, post, image) {
    if (!image) return { ok: false, error: 'Instagram posts need an image' };
    const token = env('SOCIAL_META_TOKEN', t), ig = env('SOCIAL_IG_USER', t);
    const container = await postJson(`${GRAPH}/${encodeURIComponent(ig)}/media`, { image_url: image, caption: post.caption }, token);
    if (!container.ok || !container.id) return container;
    return postJson(`${GRAPH}/${encodeURIComponent(ig)}/media_publish`, { creation_id: container.id }, token);
  },
};

const gbp: SocialAdapter = {
  network: 'gbp',
  // gbpLocationId holds the resource name "accounts/{a}/locations/{l}".
  connected: (t) => !!(env('SOCIAL_GBP_TOKEN', t) && /^accounts\/\d+\/locations\/\d+$/.test(t.integrations.gbpLocationId ?? '')),
  async publish(t, post, image) {
    const token = env('SOCIAL_GBP_TOKEN', t);
    return postJson(`https://mybusiness.googleapis.com/v4/${t.integrations.gbpLocationId}/localPosts`, {
      languageCode: 'en-US', summary: post.caption.slice(0, 1500), topicType: 'STANDARD',
      ...(post.link ? { callToAction: { actionType: 'BOOK', url: post.link } } : {}),
      ...(image ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: image }] } : {}),
    }, token, true);
  },
};

const tiktok: SocialAdapter = { network: 'tiktok', connected: () => false, publish: async () => ({ ok: false, manual: true, error: 'TikTok is manual — post from the app' }) };

export const ADAPTERS: Record<Network, SocialAdapter> = { facebook, instagram, gbp, tiktok };
export const connectedNetworks = (t: Tenant) => NETWORKS.filter((n) => ADAPTERS[n.key].connected(t)).map((n) => n.key);

/**
 * Publish to every connected network on the post. Manual networks are skipped
 * (not failures) — the post stays scheduled until "Mark as posted".
 */
export async function publishPost(t: Tenant, post: Post) {
  // Relative images (/demo/…, /uploads/…) are served by the platform host.
  const image = post.imageUrl ? (post.imageUrl.startsWith('http') ? post.imageUrl : platformUrl() + post.imageUrl) : null;
  const prev = (post.result ?? {}) as Record<string, PublishResult>;
  const results: Record<string, PublishResult> = {};
  for (const n of post.networks) {
    const a = ADAPTERS[n];
    if (prev[n]?.ok) { results[n] = prev[n]; continue; } // never double-post a network
    results[n] = a.connected(t) ? await a.publish(t, post, image) : { ok: false, manual: true, error: 'Not connected — post manually' };
  }
  const auto = Object.values(results).filter((r) => !r.manual);
  const manual = Object.values(results).filter((r) => r.manual).length;
  const failed = auto.filter((r) => !r.ok).length;
  // No connected network → stays scheduled and shows "post manually" in the queue.
  const status: 'published' | 'failed' | 'scheduled' = auto.length === 0 ? 'scheduled' : failed === auto.length ? 'failed' : 'published';
  return { status, results, manual, failed, published: auto.length - failed };
}
