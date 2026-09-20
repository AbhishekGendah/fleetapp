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

## Next
Phase 1a plan written (docs/plans/phase-1a.md), split into five
slices. Waiting on Abhi to approve slice 1 (tenancy foundation) before
any code is written.

## Open items
- Product name TBD.
- Pricing model TBD.
- SMS provider TBD.
- Confirm Stripe DDR notice rules before building rate changes.
- Decide whether migrations block the Vercel deploy, or migrations stay
  backwards compatible (slice 1).
- Decide whether the login tables sit inside RLS (slice 2).
