# BounceOS by Branch Avenue HQ

The operating system for bounce house & party rental businesses: real-time booking, inventory,
SEO websites, CRM, delivery routing, a crew app, marketing campaigns, AI social posts, an ads builder,
and a revenue-share network (platform fees, referrals, marketplace leads, partner overflow, managed ads).

Research behind the product lives in [`docs/research/`](docs/research) and decisions in [`docs/decisions/`](docs/decisions).

## Quick start (local, zero config)

```bash
npm install
npm run db:reset      # migrate + seed embedded Postgres (PGlite) in ./.data
npm run dev           # http://localhost:4321
```

| Login | Email | Password |
|---|---|---|
| Operator (Bounce Brigade, Houston) | `demo@bounceos.app` | `bounce-demo-2026` |
| Branch Avenue HQ admin | `hq@branchavenue.com` | `branch-hq-2026` |

Demo storefront: <http://localhost:4321/sites/bounce-brigade/> (or `http://bounce-brigade.localhost:4321/`).
Without Stripe keys, checkout completes through signed demo payments; without email/SMS keys, messages are logged.

## Product map

| Area | Routes |
|---|---|
| Platform (public) | `/`, `/pricing`, `/compare`, `/find` (consumer marketplace), `/signup`, `/login` |
| Operator storefront | `/` home, `/rentals/...`, `/areas/{city}`, `/book`, `/booking/{token}`, `/sitemap.xml` — on `{slug}.SITES_BASE_DOMAIN`, a custom domain, or `/sites/{slug}` preview |
| Operator app — Run | `/app` Game Plan, `/app/bookings`, `/app/inventory`, `/app/customers`, `/app/deliveries`, `/app/crew` |
| Operator app — Grow | `/app/website`, `/app/seo`, `/app/marketing`, `/app/social`, `/app/ads`, `/app/growth` |
| Operator app — Business | `/app/reports` (CSV incl. sales tax), `/app/settings/*` |
| Branch Avenue HQ | `/hq` (MRR, GMV, take rate), `/hq/tenants`, `/hq/ledger`, `/hq/marketplace` |
| APIs | `/api/public/{tenant}/*`, `/api/app/*`, `/api/stripe/webhook`, `POST /api/cron/run`, `/api/health` |

## Architecture

- **Astro 7 SSR** (Node adapter) + Preact islands only where interaction matters; Tailwind v4.
- **Postgres via Drizzle**: `DATABASE_URL` in production (Railway Postgres), embedded PGlite locally/tests.
  Schema: `src/db/schema.ts`; migrations: `drizzle/` (applied on boot; `npm run db:generate` after schema edits).
- **Multi-tenant**: every operator row carries `tenant_id`; `src/middleware.ts` maps hosts → tenants and serves operator 301 redirects.
- **Core engines** (`src/lib`): `availability` (sweep-line, buffers, packages), `booking` (holds under a per-tenant
  advisory lock — no overbooking), `pricing`, `geo` (zones, route planner), `revenue` (idempotent ledger),
  `payments` (Stripe Connect application fees), `notify` (Resend/Telnyx), `ai` (Claude copy with template fallback), `weather`.
- **Security**: scrypt passwords, hashed session tokens, origin-checked forms (CSRF), rate limits, zod validation,
  tenant-scoped queries, security headers, no secrets in the database.

## Deploy (Railway)

1. Create a Railway project with a Postgres service; deploy this repo (Dockerfile + `railway.json`, healthcheck `/api/health`).
2. Set variables from [`.env.example`](.env.example) — secrets via Railway variables / Infisical, never committed.
3. Point the platform domain and a wildcard `*.SITES_BASE_DOMAIN` at the service; operators add custom domains in Settings → Domains.
4. Add a Railway cron service: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" $PUBLIC_APP_URL/api/cron/run` every 15 minutes.
5. Stripe: create a Connect platform, set `STRIPE_SECRET_KEY` and a webhook (`checkout.session.completed`, `account.updated`, `invoice.paid`) to `/api/stripe/webhook`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :4321 |
| `npm run build` | Type-check (`astro check`) + production build |
| `npm start` | Run the production server |
| `npm test` | Unit + integration tests (in-memory Postgres) |
| `npm run db:reset` | Recreate local DB with demo data |
