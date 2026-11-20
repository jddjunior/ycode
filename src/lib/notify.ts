/**
 * Outbound email + SMS with provider adapters.
 *   Email: Resend (RESEND_API_KEY, EMAIL_FROM)   SMS: Telnyx (TELNYX_API_KEY, TELNYX_FROM)
 * With no provider configured, messages are recorded with status 'logged' so
 * every flow (receipts, review requests, campaigns) is testable end to end.
 * Secrets come from the environment (Railway/Infisical) — never the database.
 */
import { getDb, schema } from '../db/client';
import { escapeHtml } from './util';

export interface Outbound {
  tenantId: string; channel: 'email' | 'sms'; to: string; subject?: string; body: string;
  campaignId?: string; customerId?: string; bookingId?: string; fromName?: string; replyTo?: string;
}

async function sendEmail(m: Outbound): Promise<{ ref: string | null; status: 'sent' | 'logged' }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ref: null, status: 'logged' };
  const from = `${m.fromName ?? 'BounceOS'} <${process.env.EMAIL_FROM ?? 'bookings@bounceos.app'}>`;
  const html = m.body.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject ?? '', html, text: m.body, reply_to: m.replyTo }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { id?: string };
  return { ref: j.id ?? null, status: 'sent' };
}

async function sendSms(m: Outbound): Promise<{ ref: string | null; status: 'sent' | 'logged' }> {
  const key = process.env.TELNYX_API_KEY, from = process.env.TELNYX_FROM;
  if (!key || !from) return { ref: null, status: 'logged' };
  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: m.to, text: m.body + '\nReply STOP to opt out.' }),
  });
  if (!res.ok) throw new Error(`telnyx ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data?: { id?: string } };
  return { ref: j.data?.id ?? null, status: 'sent' };
}

export async function send(m: Outbound) {
  const db = await getDb();
  let status: 'sent' | 'logged' | 'failed' = 'logged', ref: string | null = null, error: string | null = null;
  try {
    const r = m.channel === 'email' ? await sendEmail(m) : await sendSms(m);
    status = r.status; ref = r.ref;
  } catch (e) { status = 'failed'; error = (e as Error).message; }
  const [row] = await db.insert(schema.messages).values({
    tenantId: m.tenantId, channel: m.channel, to: m.to, subject: m.subject ?? '', body: m.body,
    campaignId: m.campaignId, customerId: m.customerId, bookingId: m.bookingId, status, providerRef: ref, error,
  }).returning();
  return row;
}

/** Simple {{var}} merge for campaign templates. Unknown vars render empty. */
export function merge(tpl: string, vars: Record<string, string | number | null | undefined>) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''));
}
