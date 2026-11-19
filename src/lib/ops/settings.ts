/** Tenant settings writes (always invalidate the host→tenant cache afterwards). */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import { invalidateTenantCache } from '../tenant';
import type { OpsSettings } from './ctx';

type TenantPatch = Partial<typeof schema.tenants.$inferInsert>;

export async function updateTenant(tenantId: string, patch: TenantPatch) {
  const db = await getDb();
  await db.update(schema.tenants).set({ ...patch, updatedAt: new Date() }).where(eq(schema.tenants.id, tenantId));
  invalidateTenantCache();
}

export async function patchSettings(tenantId: string, current: OpsSettings, patch: Partial<OpsSettings>) {
  await updateTenant(tenantId, { settings: { ...current, ...patch } });
}

export const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico'];
