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
  - Deployed: `admin_auth_role` created in Neon, the three settings
    added in Vercel, migration 0001 applied to the dev database.

- First Admin created on the dev database
  (abhishek.gendah@altusglobalsolutions.com.au). Fixed two bugs in the
  command on the way: it needed the app's DATABASE_URL just to load, and
  it exited silently when the password was piped in.
- Abhi signed in, enrolled an authenticator app and saved the password
  and recovery codes in Bitwarden ("Fleet Admin (dev)").

- Phase 1a slice 3 — Operators and invites (plan:
  docs/plans/slice-3-operators-and-invites.md):
  - Admin can create an Operator (with its User), list Operators, resend
    an invite, suspend and reactivate. Every action is in the Operator's
    activity log.
  - Invite links expire after 7 days; only a fingerprint is stored.
    Resend cancels the old link.
  - New `packages/email`: one sending interface, React Email templates.
    Emails go to a test inbox page in admin while
    `EMAIL_TRANSPORT=dev_outbox`.
  - Migration 0002: `operator_invites`, `dev_email_outbox`,
    `operators.suspended_at`. The Operator app's role can't read invites
    or the inbox, and can't lift its own suspension.
  - New admin settings: `APP_URL`, `EMAIL_TRANSPORT`, `EMAIL_FROM`.
  - Deployed: settings added in Vercel, migration 0002 applied to the dev
    database. Abhi tested create, resend, suspend and reactivate on the
    live dev site.

## Next
Slice 4 of Phase 1a — Operator sign-in: accepting an invite (password,
authenticator, recovery codes), sign-in, 14-day trusted device,
lockout, password reset, new-device email. Includes the narrow invite
lookup recorded in the slice 3 plan, and making sign-in respect
suspension.

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
- Cloud sessions reach Neon only if the Neon host is in the
  environment's Allowed domains, AND only through Node's built-in
  WebSocket with NODE_USE_ENV_PROXY=1 (the `ws` library ignores the
  session proxy). Done as a one-off for the first-Admin run. Any future
  script run against Neon from a session needs the same.
- Suspension is recorded but not yet enforced: nothing can sign in as an
  Operator until slice 4, which must check `suspended_at`.
- `EMAIL_TRANSPORT=dev_outbox` must never be set in production: the test
  inbox holds working invite links. Production needs Postmark first.
- The admin app can't be run against a local Postgres (it uses Neon's
  driver), so new admin pages are checked by tests and a production
  build, then on the live dev site.
