# Phase 1a plan

Status: slice 1 built. Slices 2 to 5 not started.

Phase 1a in the roadmap is too big for one review or one commit, so it
is split into five slices. Each slice is separately reviewable,
separately testable on the dev site, and ends green in CI.

## Slice 1 — Tenancy foundation (done)

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

Decided: the migration job and the Vercel deploy both run off the same
push and neither waits for the other, so every migration must be
backwards compatible with the code already deployed — add columns and
tables in one release, remove them in a later one.

Also decided while building: the table owner is subject to forced
row-level security too, and no policy grants it access. Owner-run DDL
is fine; owner-run data changes see no rows. Data work goes through the
application roles.

## Slice 2 — Admin login

Full plan: docs/plans/slice-2-admin-login.md.

Decided: the login tables stay inside row-level security, and the login
system gets its own database role that can reach those tables and
nothing else. Sign-in needs no Operator context, so nothing has to be
bent to fit; and a bug in ordinary app code cannot reach password
hashes, because the connection it runs on has no access to them.

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
