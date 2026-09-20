# Progress

## Done
- Design docs and rulebook.
- Monorepo skeleton.
- Neon dev database (Sydney) with `web_app_role` and `admin_app_role`
  (NOBYPASSRLS).
- Both apps live on Vercel (Sydney):
  - Operator app: fleet.altusglobalsolutions.com.au
  - Admin app: fleet-admin.altusglobalsolutions.com.au
  - Health checks passing on both.
- Commit identity and no-attribution hooks.
- Phase 1a slice 1 — tenancy foundation:
  - Tables: operators, users, admin_users, activity_log.
  - Row-level security enabled AND forced on every table, with
    per-role policies and grants. No role can delete anything, and an
    Operator cannot change its own Stripe or subscription status.
  - activity_log is append-only, enforced by a database trigger as
    well as by withheld grants.
  - `withTenant()` sets the Operator for one transaction only.
  - Migrations run automatically on every push to main.
  - Tests against a real Postgres: Operator A cannot read Operator
    B's data, and a structural check fails the build if a future
    table is added without tenant scoping.

## Next
Slice 2 of Phase 1a: admin login (Better Auth, mandatory TOTP,
recovery codes, and a safely gated way to create the first admin).
Needs the decision below on the login tables and RLS first.

Abhi needs to add the `DATABASE_MIGRATION_URL` secret in GitHub before
migrations can run automatically.

## Open items
- Product name TBD.
- Pricing model TBD.
- SMS provider TBD.
- Confirm Stripe DDR notice rules before building rate changes.
- Migrations do NOT block the Vercel deploy; every migration must be
  backwards compatible with the deployed code instead. Decided in
  slice 1.
- Decide whether the login tables sit inside RLS (slice 2).
- When Renters arrive: admins can currently read every Operator's
  activity log, which is where Renter details will end up. Needs
  narrowing in the slice that adds Renter records.
