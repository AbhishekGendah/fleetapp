# Phase 1a plan

Status: awaiting approval. Nothing here is built yet.

Phase 1a in the roadmap is too big for one review or one commit, so it
is split into five slices. Each slice is separately reviewable,
separately testable on the dev site, and ends green in CI.

## Slice 1 — Tenancy foundation

The most important slice. Everything later sits on it, and it is the
only slice that is hard to change afterwards.

Tables:
- `operators` — the business. Identity fields (legal name, trading
  name, ABN, GST registration, address, contact, state, timezone),
  Stripe connected-account fields, `subscription_status`. Settings
  columns come in 1b, not here.
- `users` — an Operator's login. `operator_id NOT NULL`. Better Auth
  owns the credential columns from slice 4; slice 1 creates the table
  and the Operator link only.
- `admin_users` — AGS staff. Not tenant-owned.
- `activity_log` — append-only. Actor type (`user` | `admin` |
  `system` | `renter_link`), actor id, entity type, entity id, action,
  before/after JSON, timestamp.

Tenancy plumbing:
- Every tenant table gets `operator_id NOT NULL` with a foreign key.
- RLS enabled AND forced on every tenant table, with a policy scoping
  rows to the Operator in the current transaction's tenant context.
- Explicit grants: `web_app_role` gets the tenant tables, and
  `admin_app_role` gets the tables admin needs. Neither gets the
  other's. `admin_users` is not readable by `web_app_role`.
- A `withTenant(operatorId, callback)` helper: opens a transaction,
  sets tenant context for that transaction only, runs the query. It
  throws on a missing or malformed `operatorId` rather than running
  unscoped. Tenant context is set with a bound parameter
  (`set_config(..., true)`), never by string concatenation, because
  `SET LOCAL` cannot take a parameter.
- Automatic migrations: a GitHub Actions job runs the migrations
  against the dev database on every push to `main`, using the
  owner-role connection string from GitHub secrets.

Tests (Vitest, against Postgres in Docker in the session):
- Tenant isolation: Operator A cannot read Operator B's rows, on every
  tenant table, via the app's real role.
- No tenant context set means no rows, never all rows.
- A structural test that walks the live schema and fails if any
  tenant-owned table is missing `operator_id NOT NULL`, or has RLS
  not enabled, or not forced. This is the safety net that stops a
  future table being added without protection.
- The activity log rejects updates and deletes.

Decision in this slice: migration timing. The migration job and the
Vercel deploy both run off the same push, so which finishes first is
not guaranteed. Recommendation: accept that, and require every
migration to be backwards compatible (add first, remove in a later
release), so either order is safe. The alternative is blocking deploys
until migrations finish, which is stricter but means a failed migration
takes the site down with it.

## Slice 2 — Admin login

Better Auth instance for `apps/admin`, its own tables (prefixed so they
never collide with the Operator app's), mandatory TOTP, recovery codes
shown once. A one-off, safely gated way to create the very first admin,
which disables itself afterwards.

Decision needed before this slice: whether the login tables sit inside
RLS. They cannot be fully scoped by Operator, because at sign-in time
there is no Operator context yet — the email is what identifies the
Operator. Recommendation: treat the login tables as platform tables
outside the RLS layer, keep `operator_id` on `users` as a normal
column, and rely on server-side authorisation for anything user-facing
(which rule 4 requires regardless). RLS stays as the second layer for
Renter and rental data, which is what it is actually protecting. The
alternative is contorting the auth flow to fit RLS, which adds risk to
the most security-sensitive path in the app.

## Slice 3 — Operators and invites

Create and list Operators in admin, with an expiring invite email.
Resend invite, suspend, reactivate. A dev-only email outbox viewable in
admin behind an env flag, so invites can be tested before Postmark
exists. Every admin action written to the activity log.

## Slice 4 — Operator sign-in

Invite acceptance (password, TOTP, recovery codes), sign-in, 14-day
trusted device, temporary lockout after repeated failures, password
reset by email, new-device email alert.

## Slice 5 — Placeholder dashboard

A signed-in Operator landing page, mobile-first at 375px, with the
setup checklist stubbed out. Real dashboard numbers are Phase 7.

## Not in Phase 1a

Operator settings, S3 file storage, the shared list component (1b).
Vehicles and Renters (Phase 2).
