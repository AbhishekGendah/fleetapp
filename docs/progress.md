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
  - Migrations run automatically on every push to main, using the
    `DATABASE_MIGRATION_URL` GitHub secret. Applied to the dev
    database: all four tables are live.
  - Tests against a real Postgres: Operator A cannot read Operator
    B's data, and a structural check fails the build if a future
    table is added without tenant scoping.
- Phase 1a slice 2 — admin login:
  - Email, password and an authenticator code, required on every
    sign-in. No "remember this device" for Admins.
  - A third database role, `admin_auth_role`, used only by the login
    system. The role the rest of the admin app runs on is granted
    nothing on the credential tables.
  - `create-first-admin` command: run by hand, refuses to run twice.
  - Separate append-only Admin audit trail.
  - Tests sign in for real against a Postgres with the real
    migrations applied.

## Next
Slice 3 of Phase 1a: creating and listing Operators in admin, with
invite emails and a dev-only outbox to test them before Postmark.

Before slice 2 can be deployed, Abhi needs to create the
`admin_auth_role` database role in Neon and add three environment
variables in Vercel. The migration grants to that role, so it must
exist before the next push to main.


## Open items
- Product name TBD.
- Pricing model TBD.
- SMS provider TBD.
- Confirm Stripe DDR notice rules before building rate changes.
- Migrations do NOT block the Vercel deploy; every migration must be
  backwards compatible with the deployed code instead. Decided in
  slice 1.
- Login tables stay inside RLS, reached only by a dedicated database
  role. Decided before slice 2.
- Abhi to pick the name shown inside the authenticator app
  (`AUTH_ISSUER_NAME`). Awkward to change once Admins have enrolled.
- "Remember this device" IS configurable after all (`trustDeviceMaxAge`
  in Better Auth 1.7.5; the published docs are out of date). The 14 days
  in docs/design/01 is achievable for Operators in slice 4. Off
  entirely for Admins.
- `BETTER_AUTH_SECRET` encrypts every authenticator enrolment. Losing it
  means every Admin re-enrols. Belongs in Bitwarden as well as Vercel.
- When Renters arrive: admins can currently read every Operator's
  activity log, which is where Renter details will end up. Needs
  narrowing in the slice that adds Renter records.
