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

- Phase 1a slice 4, part 4a — Operator sign-in (plan:
  docs/plans/slice-4-operator-sign-in.md):
  - Invited Users accept their invite (password, authenticator, recovery
    codes) and sign in, with "remember this device for 14 days".
  - A fourth database role, `web_auth_role`, for the Operator login only.
    Migration 0003 adds the User login tables (with `operator_id` filled
    by a trigger) and narrows both app roles' rights on `users`.
  - 5 wrong passwords lock a login for 15 minutes, in BOTH apps (the
    admin login had no real limit before).
  - Suspended Operators' Users are refused at sign-in and stopped on
    their next click.
  - Admin sign-in now accepts a recovery code (it had no way to before).
  - Admin Operator list shows last sign-in.
  - Deployed: `web_auth_role` created in Neon (password rotated after it
    showed in a screenshot), three settings added to `fleetapp-web`,
    migration 0003 applied. Abhi tested accepting an invite, sign-in,
    remember-this-device, suspend and reactivate on the live dev site.

- Phase 1a slice 4, part 4b:
  - Forgot password: emailed link, 1 hour, single use, stored only as a
    fingerprint. Signs out every other session and lifts a lockout; never
    skips the authenticator. Same answer whether or not the email exists.
    It also forgets every "remembered" device, so the next sign-in
    anywhere needs the authenticator code (Abhi's suggestion).
  - New-device email: a sign-in from a browser the User has not used
    before emails them the device and time (Operator's timezone). Migration
    0004 adds `user_known_devices` (cookie fingerprints only).
  - Shared email layout and `createEmailSender` for both apps.
  - Fixed after Abhi's testing: a click before a page finished loading did
    nothing, and on sign-in pages could have put the email and password in
    the address bar. Browser-handled forms now post, and their buttons stay
    disabled until the page is ready (`ClientForm` in packages/ui).

- Phase 1a slice 5 — placeholder dashboard:
  - Header with business name and sign-out, a greeting by the Operator's
    own clock, and the setup checklist with progress.
  - Checklist steps are worked out from the Operator's records, never
    stored as ticks. Business details counts as done once legal name,
    ABN, address, phone and email are all filled in; Stripe once charges
    are enabled. Contract and cars/Renters steps wait for their phases.
  - Checked at 375px and desktop width.

**Phase 1a is complete.**

- Phase 1b slice 1 — look and feel (plan: docs/plans/phase-1b.md):
  - PintoFleet brand file (`packages/ui/src/brand.ts`): name and colours
    from the PintoTech emblem (navy `#0D3747`, teal `#167884`, cyan
    `#2FA7B4` for decoration), amber for attention; a test keeps it in
    step with `theme.css`. Manrope throughout. Logo: the emblem plus a
    drawn PINTOFLEET wordmark (PintoTech letters; F and L built from its
    E). The emblem is also the browser-tab icon.
  - Authenticator codes are typed into six boxes and checked on the last
    digit (shared `CodeInput` in packages/ui).
  - Operator app shell: bottom tab bar on phones, sidebar from tablet
    width; Home and Settings (Settings is a placeholder until slice 2).
  - Sign-in style pages share one frame with the logo; admin carries an
    "Admin" label. Emails use the brand name and colour.

- Phase 1b slice 2 — Operator settings:
  - Business details form in Settings (ABN checksum, GST date rules,
    postcode-state warning, every Australian timezone). Each save logs
    before/after of what changed. The checklist step links to it.
  - `operator_settings` (migration 0005): one validated document per
    Operator, defaults in code, version per save, frozen snapshot for
    rentals. The schema is empty until a feature needs a setting; loading
    and saving arrive with the first real setting (Phase 2).
  - Business details form checks as you go: each box is checked when you
    leave it, then with every key, by the same rules the server uses on
    save. ABN, phone and postcode format as you type and stop at their
    length (phone: mobiles, landlines in brackets, 1300/1800/13, +61
    turned into 0). Phones are stored in that format. Save with a problem
    goes to the first one and sends nothing. Fixes the GST tick showing
    unticked after a refused save.
  - Address lookup on the street address box: suggestions from Google
    as you type (Australia only, signed-in Users only, called from our
    server). Picking one fills street, suburb, state and postcode; every
    box stays editable, and if Google is down or capped it is a plain box.
    Suggestions favour the chosen state (else the timezone's state);
    the app then lists that state's suggestions first itself, as
    Google treats the state as a hint only. Interstate ones follow.
  - Legal name, ABN, street, suburb, state, postcode, phone and email are
    now required (trading name, address line 2 and GST date stay
    optional). Same set as the setup checklist step. Columns stay nullable
    in the database: no migration.
- Clean-up after slice 2 (repo-wide review):
  - Every required field has a red asterisk (shared `FormField` and
    `RequiredFieldsNote` in packages/ui); rule 28 in CLAUDE.md makes it
    the standard for every form.
  - Logs hold only the kind of error, never its message (a database
    error's message can quote personal data). `describeErrorForLog`.
  - Shared in core instead of copied: required business details, form
    text rules, digits, time units, locale, Operator display name, URL
    joining. Admin has a paths module; no hardcoded page paths.
  - Dead code and misplaced dependencies removed; stale docs fixed.
  - Approved follow-up (sign-in and history): Admin emails stored
    lower-cased; one set of login rules in `@fleetapp/auth/login-policy`
    (password length, lockouts, recovery codes, new-password schema,
    checked as you type on the invite and reset pages); one
    `recordActivity` in `@fleetapp/db/activity`; one `getAccountAccess`.
  - Lint now enforces the standards: no `any`, no empty catch, no stray
    console output, explicit return types on exported functions in `.ts`
    files (React components in `.tsx` are left to inference).
- Leaked passwords refused: every new password (invite, reset, first
  Admin) is checked against Have I Been Pwned by its fingerprint's first 5
  characters. If the service is down the password is allowed and a
  warning logged.
- Keeping one standard: the linter refuses raw buttons, boxes, dropdowns,
  labels and tables in the apps (rule 29); a Components page in admin
  shows every shared piece; CI fails on copy-pasted code (`pnpm
  duplicates`, rule 30). Sign-in browser code, sign-out, the health
  check and the shared settings checks now live in one place each.
- Next decision: session timeouts (plan with Abhi).
  - CI had been failing since the logo went in (the svg types were only
    found after a Next build); fixed, CI green again.

## Next
Phase 1b slice 3: file storage (S3 in Sydney), with the Operator's logo
as the first use. Needs Abhi to set up AWS, one step at a time.

## Open items
- Address lookup: Google Places (New), project `fleetapp-dev-513004` on
  the Altus Google account. Key `fleetapp-web-dev` (Places API (New)
  only) in Bitwarden and Vercel. Daily caps 300 each on
  AutocompletePlacesRequest and GetPlaceRequest; budget alert at $10.
  Before production: a production project with higher caps, and an
  in-app daily limit per Operator (needs a small table: plan first).
- Legal notes for the privacy policy and terms are kept in
  docs/legal-notes.md; every task now checks the legal side.
- Product name decided: PintoFleet (rule updated in CLAUDE.md). The logo
  is the PintoTech emblem plus a PINTOFLEET wordmark built from the
  PintoTech letters. A simpler emblem for small sizes (browser tab, phone
  header) would still help. Abhi to check the name is free
  (ASIC business names, IP Australia trade marks, domain).
- `AUTH_ISSUER_NAME` and `EMAIL_FROM` are set to PintoFleet in both
  Vercel projects. Authenticator entries made before then keep their old
  name until re-enrolled.
- Pricing model TBD.
- SMS provider TBD.
- Confirm Stripe DDR notice rules before building rate changes.
- Migrations do NOT block the Vercel deploy; every migration must be
  backwards compatible with the deployed code instead. Decided in
  slice 1.
- Login tables stay inside RLS, reached only by a dedicated database
  role. Decided before slice 2.
- "Remember this device": 14 days for Users (built in slice 4), off
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
- `EMAIL_TRANSPORT=dev_outbox` must never be set in production: the test
  inbox holds working invite links. Production needs Postmark first.
- The admin app can't be run against a local Postgres (it uses Neon's
  driver), so new admin pages are checked by tests and a production
  build, then on the live dev site.
- Old branches on GitHub are no longer needed (main has everything):
  `backup/slice-4a`, `claude/vibrant-dijkstra-4jzf8i`,
  `claude/whats-next-1mm9ou`. Abhi to delete them.

- A "forgot password" request for a real address takes a little longer to
  answer than one for an unknown address (the email is sent before
  replying), which in theory hints which addresses have logins. Fix when
  Postmark goes in: send in the background with Vercel's waitUntil.
- Admin password reset (deferred from slice 2) still not built: an Admin
  who forgets their password needs the first-Admin approach or a direct
  database fix. Worth its own small change.
- When a "change my password" setting is built for Users (or Admins), it
  must forget remembered devices too, as password reset now does
  (`forgetRememberedDevices` in apps/web/src/lib/password-reset.ts).
- Admin redeploy after the `EMAIL_TRANSPORT` typo: later pushes deploy
  admin again, so this resolves itself; check `fleetapp-admin` shows a
  recent deployment as Ready.
