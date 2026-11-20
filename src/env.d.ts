/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    session: import('./lib/auth').SessionCtx | null;
    /** Set on storefront requests. */
    site?: {
      tenant: import('./lib/auth').Tenant;
      /** '' when served on the tenant's own host, '/sites/{slug}' in platform preview. */
      base: string;
    };
    cspNonce: string;
  }
}
