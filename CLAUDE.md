# Project Rulebook

@docs/coding-standards.md

The AGS coding standards (imported above) apply everywhere. The rules
below are project-specific. If a request conflicts with anything here,
STOP and ask. Never work around a rule.

## What this is
Multi-tenant SaaS for Australian vehicle rental businesses (weekly and
ongoing rentals, often rideshare). Built by Altus Global Solutions
(AGS). Australia only. Product name TBD: never hardcode a brand name,
domain or URL path. Base URLs come from env vars (APP_URL, ADMIN_URL).

## Terminology (use exactly, in code and UI)
- Operator: the business that subscribes (the tenant). Key: operatorId.
- User: an Operator's login. One per Operator in v1, but a separate
  table so more Users per Operator can be added later.
- Renter: the Operator's customer. Renters never log in; they use
  tokenised links only.
- Admin: AGS platform staff. Separate table, separate app.

Never use "client", "customer" or "tenant" for these in code.

## Stack
- Monorepo: pnpm + Turborepo
  - apps/web: Operator app + renter link pages
  - apps/admin: AGS admin area (separate subdomain)
  - packages/db: Drizzle schema, migrations, DB client
  - packages/core: pure domain logic (money, dates, ledger, matching)
  - packages/ui: shared components
  - packages/config: shared tsconfig / eslint
- Next.js latest stable, App Router, TypeScript strict. Next 16+ uses
  proxy.ts instead of middleware.ts.
- PostgreSQL on Neon, Sydney region. Separate dev and production
  databases.
- Drizzle ORM, pinned to the stable release.
- Better Auth: separate instances for web and admin. TOTP 2FA mandatory.
- Zod at every boundary (routes, actions, forms, webhooks, env, imports).
- Stripe: Connect Express, direct charges on the Operator's connected
  account. BECS direct debit now, PayTo later. AGS subscriptions via
  Stripe Billing on the AGS platform account.
- Files: storage interface over AWS S3 ap-southeast-2. Separate dev and
  production buckets.
- Email: interface. Postmark (test mode outside production). React Email
  templates.
- SMS: interface. Provider TBD.
- Hosting: Vercel, functions pinned to syd1. apps/web and apps/admin are
  separate Vercel projects.
- Tests: Vitest.

## Development environment
- Development happens in Claude Code on the web. No local machine is
  assumed.
- Every change goes on a branch, then a PR, which gets a Vercel preview
  deployment.
- Preview deployments are password-protected and use the dev database
  with fake data only. Real Renter data never exists outside production.
- Tests may run Postgres in Docker inside the cloud session.

## Tenancy and security (non-negotiable)
1. Every tenant-owned table has operator_id NOT NULL. Every query is
   scoped by the operatorId from the authenticated session, never from
   request input.
2. Postgres RLS is enabled AND forced on every tenant table as a second
   layer. The app connects as a non-owner role without BYPASSRLS.
   Tenant context is set per transaction with SET LOCAL.
3. Webhooks and background jobs have no session. Resolve the Operator
   from trusted data (e.g. Stripe event.account -> Operator) and set
   tenant context explicitly, one Operator at a time.
4. Authorisation happens in server code (route handlers, server
   actions, data layer). proxy.ts is routing only, never a security
   boundary.
5. apps/admin uses its own DB credentials and auth. Admin cannot read
   Renter personal data in v1.
6. Secrets only in env vars, validated with Zod at startup. Fail fast
   if missing. Stripe secret key never in client code or NEXT_PUBLIC_.
7. Never log personal data, tokens, licence details or bank details.
   Never store bank or card details; Stripe holds them.
8. Identity documents (licence scans etc.) live in a separate private
   storage location, are served only via short-lived signed URLs, and
   every view is written to the activity log.

## Data rules (non-negotiable)
9.  Money is integer cents (AUD), never floats. Each ledger line stores
    its GST amount explicitly. GST treatment is set per charge type.
10. Timestamps are stored as UTC timestamptz and displayed in the
    Operator's timezone. Fine offence times are entered in the local
    time of the offence location and converted.
11. The ledger is append-only. Never update or delete ledger lines.
    Corrections are reversing entries. Balances are always calculated
    from the ledger, never stored as the source of truth.
12. Issued documents (signed contracts, handover/return reports,
    invoices, statements) are immutable. Store the PDF plus a SHA-256
    hash. Changes = new version or credit note.
13. Core records are archived, never hard-deleted. The only hard
    deletes are scheduled retention jobs.
14. A rental snapshots the Operator's settings when created. Settings
    changes affect new rentals only. Changing an active rental's terms
    is an explicit, logged change.
15. Possession: fine matching uses possession records. Possession
    starts at the Renter's signed handover acceptance and ends at the
    recorded return. A car swap closes one record and opens another.
16. Payment method is a generic type field (becs_debit now, payto
    later). No BECS-specific columns in core tables.
17. Invoice numbers are sequential per Operator, with no gaps.
18. Double-booking is prevented at database level (exclusion constraint
    on vehicle + time range; ongoing rentals are open-ended ranges).
19. Every create/update/delete writes to the activity log with actor
    type: user, admin, system or renter_link.
20. Idempotency: webhook handlers record processed Stripe event IDs and
    ignore repeats. Scheduled jobs are safe to re-run: a unique
    constraint prevents charging a rental twice for the same period.

## Files and storage
21. Photos are resized on the device before upload (about 1600px long
    edge, about 400 KB) plus a thumbnail. Each file is stored once;
    PDFs embed small copies.
22. Uploads: images and PDFs only, with a per-file size cap. Validate
    file type server-side from content, not just the extension.
23. Lifecycle: photos from rentals closed over 1 year move to S3 Glacier
    Instant Retrieval. Deleted files are recoverable for 30 days, then
    purged. Abandoned uploads are cleaned up. Storage used is tracked
    per Operator.

## Product rules
24. Mobile-first: design at about 375px wide first. Tables collapse to
    cards on mobile. Touch targets at least 44px.
25. The handover/return checklist must survive poor signal: save
    progress on the device and queue photo uploads.
26. Renter links are single-purpose, expiring and revocable. Store only
    a hash of each token. They require a one-time code on a new device
    and never expose identity documents.
27. Operator settings have sensible defaults and are all editable.

## How to work
- Read the relevant docs/design/*.md file before working on an area.
- For anything touching schema, money, auth or tenancy: show a plan
  first and wait for approval before editing.
- Small, single-purpose changes. Conventional commits.
- Every schema change goes through a Drizzle migration. Never edit a
  migration that has already been applied.
- Tests are required for: money and GST calculations, the ledger,
  possession and fine matching, timezone handling, and tenant isolation
  (a test proving Operator A cannot read Operator B's data).
- Don't add a dependency without stating why.
- Abhi reviews on his phone. Every PR description must explain in
  plain English: what changed, how to test it on the preview link, and
  anything he needs to decide.
