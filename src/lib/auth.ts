/**
 * Password + session auth.
 *  - scrypt (N=2^15, r=8, p=1) with per-user salt, constant-time compare.
 *  - Opaque 192-bit session token in an HttpOnly, Secure, SameSite=Lax cookie;
 *    only its sha256 is persisted, so a DB leak doesn't leak sessions.
 */
import { scrypt as _scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { AstroCookies } from 'astro';
import { getDb, schema } from '../db/client';
import { sha256, token } from './util';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = 'bos_session';
const SESSION_DAYS = 30;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, { ...PARAMS, N: Number(n) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export async function createSession(userId: string, tenantId: string | null, cookies: AstroCookies, secure: boolean) {
  const db = await getDb();
  const raw = token(24);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ tokenHash: sha256(raw), userId, activeTenantId: tenantId, expiresAt });
  cookies.set(SESSION_COOKIE, raw, { httpOnly: true, secure, sameSite: 'lax', path: '/', expires: expiresAt });
}

export async function destroySession(cookies: AstroCookies) {
  const raw = cookies.get(SESSION_COOKIE)?.value;
  if (raw) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(raw)));
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export type Tenant = typeof schema.tenants.$inferSelect;
export type Role = 'owner' | 'manager' | 'crew';

export interface SessionCtx {
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean };
  tenant: Tenant | null;
  role: Role | null;
  tokenHash: string;
}

export async function readSession(cookies: AstroCookies): Promise<SessionCtx | null> {
  const raw = cookies.get(SESSION_COOKIE)?.value;
  if (!raw || raw.length > 64) return null;
  const db = await getDb();
  const th = sha256(raw);
  const [row] = await db.select({ s: schema.sessions, u: schema.users })
    .from(schema.sessions).innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, th), gt(schema.sessions.expiresAt, sql`now()`))).limit(1);
  if (!row) return null;
  let tenant: Tenant | null = null;
  let role: Role | null = null;
  const ms = await db.select({ m: schema.memberships, t: schema.tenants })
    .from(schema.memberships).innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(eq(schema.memberships.userId, row.u.id));
  const active = ms.find((m) => m.t.id === row.s.activeTenantId) ?? ms[0];
  if (active) { tenant = active.t; role = active.m.role; }
  return { user: { id: row.u.id, email: row.u.email, name: row.u.name, isPlatformAdmin: row.u.isPlatformAdmin }, tenant, role, tokenHash: th };
}

export const PASSWORD_RULE = 'At least 10 characters.';
export const passwordOk = (pw: unknown): pw is string => typeof pw === 'string' && pw.length >= 10 && pw.length <= 200;
