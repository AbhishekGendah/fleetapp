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
- Leaked passwords warned about, not refused (Abhi's decision): every new
  password (invite, reset, first Admin) is checked against Have I Been
  Pwned by its fingerprint's first 5 characters. A leaked one shows an
  amber warning and "Use this password anyway"; pressing it again keeps
  it. If the service is down, no warning is shown.
- Keeping one standard: the linter refuses raw buttons, boxes, dropdowns,
  labels and tables in the apps (rule 29); a Components page in admin
  shows every shared piece; CI fails on copy-pasted code (`pnpm
  duplicates`, rule 30). Sign-in browser code, sign-out, the health
  check and the shared settings checks now live in one place each.
- Phase 1b slice 3a, file storage: AWS account (Altus, Paid plan, $10
  budget alert), buckets `altus-fleetapp-dev-files` and
  `altus-fleetapp-dev-identity` in Sydney (private, versioned, deleted
  copies kept 30 days, uploads only from the dev site), app login
  `fleetapp-web-dev` limited to the two buckets (key in Bitwarden and
  Vercel). `files` table (migration 0006) under forced row-level
  security; admin reads sizes only. Upload: server-issued 10-minute
  permission for one address, then a first-bytes check. Logo upload in
  Settings, shown in the header; one logo in use per Operator. Admin
  Operator list shows storage used. Shared ImageUpload in the catalogue.
- Phase 1b slice 3b, daily file clean-up: Vercel's scheduler calls
  `/api/cron/file-housekeeping` at 3am Perth with `CRON_SECRET`. It purges
  files deleted over 30 days ago and uploads unfinished after 24 hours,
  one Operator at a time with its tenant context set; it finds them
  through `app.operators_with_file_housekeeping_due` (migration 0007),
  which returns Operator IDs only. Purged records stay; each removal is
  logged as done by the system.
- Phase 1b slice 4, the shared list: `DataList` in packages/ui (table on
  a wide screen, cards on a phone, sort by heading, search, filters,
  pages of 25, CSV and Excel export of everything matching) from one
  column definition; the rules are pure functions in core
  (`list-query`, `spreadsheet-cells`, `@fleetapp/core/spreadsheet`).
  Export cells that look like formulas are made plain text. The admin
  Operator list uses it; it still loads all Operators from the database
  and pages on the server, fine at this size, to move to database
  paging when lists grow (Phase 2's lists page in the database).
- Session timeouts (approved): Users signed out after 7 days without use
  and at 30 days at most; Admins after 30 minutes without use and at 8
  hours at most. The hard limit ends the sign-in for good and the sign-in
  page says why. Numbers in `@fleetapp/auth/login-policy`.
  - CI had been failing since the logo went in (the svg types were only
    found after a Next build); fixed, CI green again.
- Installable Operator app (a "web app" on the home screen, no app
  store): manifest from the brand file, home-screen icons made from the
  emblem (`apps/web/public/app-icons`, `src/app/apple-icon.png`), opens
  full screen with no browser bars. A dismissible guide on the dashboard
  (`InstallAppHint` in packages/ui, in the catalogue): an Install button
  on Android, the Share → Add to Home Screen steps on iPhone, hidden on
  desktops and once added. Offline use comes with the handover checklist
  (rule 25), not now.

- Phase 2 approved (docs/plans/phase-2.md). Step 1, cars:
  - Tables `vehicles` and `odometer_readings` (migration 0008), RLS
    forced, Operator-only; admin has no access. One rego per state per
    Operator and one VIN per Operator (archived cars excepted). Readings
    are never changed: one entered by mistake is withdrawn. A reading
    always points at a car of its own Operator (two-column link).
  - Screens: Cars in the menu; list (search every word, status filter,
    archived cars on request, sort, pages of 25 from the database,
    CSV/Excel); add and edit form with live checks; car page with
    Details, Odometer and History tabs; status (in service and off road
    need a reason and return date); archive and restore.
  - Make and model suggest from a built-in list of cars sold in
    Australia (`packages/core/src/vehicle-models.ts`); anything else can
    be typed, with a "check the spelling" warning.
  - New shared pieces: searchable box (also used by the address lookup),
    badge, tabs, form section, state options, and one form helper that
    every form uses for live checks and sending.
  - Shared list rules now separate what a list shows from how it is
    searched, so the same list screen works in memory (admin Operators,
    which stays in memory: dozens of rows, status worked out from several
    tables) or in the database (cars).

- Step 1 follow-ups from Abhi's testing: rego is typed in capitals,
  letters and numbers only, at most 9 characters (no per-state format:
  personalised plates allow almost anything); Tab in any suggestion box
  takes the highlighted or top suggestion; adding a car asks for the
  odometer reading, saved as its first reading in the same step.

- Test checklist for Abhi: Google Sheet "Fleet app test checklist"
  (https://docs.google.com/spreadsheets/d/14exg-PBoMuTjVoc0QTXK6mgYSEfB0dSaty7yG1fqjbk/edit),
  116 rows covering both apps as built so far (A- admin site, O- Operator
  app), with a Result drop-down, notes, and a Summary tab listing every
  Issue and "Could be better". Kept up to date with every change
  (CLAUDE.md, How to work).
  - Fixed (row A-24): the admin New Operator form now checks each box as
    you type with the shared form helper, like every other form.

- Phase 2 step 2 plan approved (docs/plans/phase-2-step-2.md). 2a built:
  - Tables `vehicle_registrations`, `insurance_policies`,
    `insurance_policy_vehicles` (migration 0009): forced RLS, two-column
    links so nothing can point at another Operator's car or policy, no
    deletes, no admin access, GST at most a tenth (checked by the
    database too).
  - Money: `packages/core/src/money.ts` (typed dollars to cents, GST of a
    tenth, limits), tested. Calendar dates and "today in the Operator's
    timezone" in `calendar-dates.ts`, expiry badges in `expiry.ts`.
  - Screens: car page tab "Rego & insurance" (renewals, policies the car
    is on, add insurance for this car, put on an existing policy); Cars →
    Insurance (list, add a fleet policy with tick boxes, policy page with
    cars, edit, archive, history); car list Rego and Insurance columns
    with Due soon / Expired badges; Settings → Cars "Due soon" days
    (first real Operator setting, stored in operator_settings).
  - Fixed a bug found while building: the car list's Odometer column
    showed "Not recorded" for every car (a sub-query matched the wrong
    table's id). All such sub-queries now name their tables in full
    (`packages/db/src/qualified.ts`); a test guards it.
  - Shared along the way: one helper for logging a User's change, one for
    running a change and refreshing pages, the result message and action
    button pieces moved to `apps/web/src/components`, one history card,
    and `fieldErrorsOf` so every form checks the same short way.
  - Rego papers and insurance certificates attach in 2c, with the upload
    piece.

- Car models list moved to the database and onto the admin site (Abhi's
  request, approved): tables `vehicle_makes` and `vehicle_models` (migration
  0010, seeded from the list that was in the code, with a few nicknames).
  Admin: Car models (makes, models, add several one per line, rename,
  nicknames, hide/show, all in the admin activity log, which gained
  entity and before/after columns) and Typed by Operators (one line per
  car not in the list, Fix this car / Add to list and fix). Operators'
  car forms load the list fresh each time, so changes apply at once.
  - Smart matching (`packages/core/src/name-matching.ts`): spacing,
    capitals, dashes and dots ignored ("sea lion 6" saves as "Sealion 6"),
    nicknames ("Prado", "Merc", "VW"), near misses suggested but never
    saved without a tap ("corrola" → Corolla, with "Did you mean").
  - The admin app still cannot read cars; two narrow database functions
    (`app.vehicles_not_in_catalogue`, `app.correct_vehicle_make_model`)
    are its only way in, and they show or change make and model only.
  - Shared pieces moved to packages/ui: result message, action button,
    choose-and-apply, plus a new Textarea; the car list loader moved to
    packages/db.

- Fixes from Abhi's admin testing: sign-in reads the boxes when sent, so a
  login filled in by the browser (Firefox) is no longer refused and cleared;
  the button says Sign in (both apps); the code boxes' cursor blinks; Car
  models' add forms sit above the lists. Admin "remember this device" left
  off on purpose (Admins reach every Operator).
- **Admin sign-in time limits relaxed while testing** (Abhi's request): two
  weeks idle and 30 days at most, instead of 30 minutes and 8 hours. Must be
  restored before launch, with a full security review: see
  docs/launch-checklist.md, which now gathers every before-launch item.

- Roadmap brought up to date (docs/roadmap.md): status of every phase and
  what was added or moved along the way. Abhi confirmed no "remember this
  device" for Admins.

- GST on rego and insurance forms: hidden entirely for an Operator not
  registered for GST (Settings). Rego's GST box starts empty with a hint to
  copy the figure from the renewal notice (only the injury-insurance part
  has GST, per WA Transport); insurance still prefills a tenth. A policy
  saved earlier with GST keeps showing it when edited.

- **Phase 2 step 2b — purchase, sale and other costs** (plan:
  docs/plans/phase-2-step-2.md):
  - Costs tab on the car page: purchase (dealer or private seller, seller's
    details, odometer at purchase as a reading), other costs (refurb,
    repair, other; Remove), sale (handover time on the Operator's clock,
    buyer's details, transfer lodged date and reference), and totals with
    the difference excluding GST.
  - Saving a sale sets the car to Sold and offers Archive; Cancel this sale
    puts it back to Available. An amber "Transfer not lodged yet" note
    shows until the lodged date is in.
  - Migration 0011: `vehicle_purchases` (one per car), `vehicle_sales` (one
    not cancelled per car), `vehicle_costs`; forced row-level security, no
    deletes, no admin access, GST never above a tenth and none on a private
    purchase, all checked in the database too.
  - Buyers' and sellers' details never go into the history's values: it
    says "Buyer's phone changed" only.
  - Shared pieces: local time to UTC (daylight saving tested), shared phone
    rule, shared date and GST rules, a small form frame for car forms.
  - Moved to 2c: uploading transfer papers and receipts.

- Fixes from Abhi's car testing (built): add forms empty once saved (no
  double adds) and use one shared form frame; amounts show $ and commas as
  you type (new shared money box in packages/ui); kilometres get commas;
  VIN, policy numbers, licence numbers and references in capitals; year and
  seats digits only; History renamed Log; cost Kind renamed Type. New rule
  31 in CLAUDE.md: every field gets its proper format.
- Car testing changes (plan: docs/plans/car-testing-changes.md), built:
  - Rego terms Monthly (direct debit), 3, 6, 9 and 12 months.
  - Insurance premium has Paid: Yearly, Monthly or Fortnightly; the amount
    is one payment ("$137.50 monthly"). Existing policies are Yearly.
  - Cost types Servicing, Repair, Refurb, Other.
  - Lower odometer readings refused unless "The odometer was replaced" is
    ticked, which the log records.
  - Add and Edit forms on a car's tabs open in pop-ups (new shared
    FormDialog in packages/ui and the catalogue); a plain save closes them.
  - Migration 0012: payment_frequency column, wider rego term check, the
    new cost type.

- Rego direct debit and automatic expiry (built): a monthly direct debit
  has no expiry, shows a green "Direct debit" badge, never goes Due soon,
  and stops when a fixed term is added or with "Stop direct debit" (a date).
  Choosing a term fills in Expires as the current expiry plus the term (from
  today if there is none); a typed date is kept. Migration 0013: expiry may
  be empty only for a direct debit (checked by the database), plus
  `direct_debit_stopped_on`; monthly rows saved earlier had their expiry
  cleared. The sale form reminds to cancel the direct debit in DoTDirect.

- Duplicates and overlaps (plan: docs/plans/car-testing-changes.md): same
  rego renewal and a second running direct debit refused (with database
  rules, migration 0014, which first cleaned existing test data); direct
  debit take-over noted; same policy number with overlapping dates refused
  with a link to it; overlapping cover saved with a warning.

- **Phase 2 step 2c, part 1 — car photos and documents** (plan:
  docs/plans/phase-2-step-2.md):
  - Photos tab: add several at once from camera or gallery, each shrunk on
    the phone (about 1600px, location data dropped) plus a 400px small copy
    for the grid; each sends on its own with Try again. Tap for full size;
    Remove keeps it 30 days.
  - Documents tab: "Add a document" pop-up with a typed name and a PDF or
    image (images shrunk). Open and Remove.
  - Files open through `/cars/<car>/files/<file>`, which checks the
    Operator and then sends a 5-minute link, so page links never go stale.
  - Migration 0015: new file kinds, and on `files` a two-column link to the
    car, the document name, and a link from a small copy to its photo,
    with database checks. The admin role is not granted the new columns.
  - Shared pieces: FilePicker (packages/ui + catalogue), shrinking to any
    size, shared upload action helpers (the logo now uses them too).

- In-app camera and photo names (Abhi's request): "Take photos" opens a
  camera inside the app for many shots in a row (strip with take-out, Done
  sends all); "Add from gallery" still picks from the phone. Photos are sent
  one after another and named "1ABC234 2026-10-30 001" (rego, day on the
  Operator's clock, number per car per day, locked so two at once never
  share a number). Opened or shared files use their name. Migration 0016
  named photos already uploaded and added a one-name-per-car rule. No
  in-app PDF reader: the phone's own viewer is used (decided with Abhi).
  New shared piece: CameraCapture (packages/ui + catalogue).

- **Phase 2 step 2c, part 2 — attachments:** "Attach" on each rego
  renewal, insurance policy (car page and policy page), cost, the purchase
  and the sale. Several files at once, images shrunk on the phone, named
  after the record ("1ABC234 rego 2027-10-29 1"). Purchase and sale papers
  go in the private identity storage and every opening is logged. Files
  open through `/attachments/<file>`, which checks the Operator first.
  Migration 0017: two new file kinds and a two-column link from `files` to
  each record kind, with database checks. Policy page Log now includes its
  papers.
- Lists: a tap anywhere on a card (phone) or row (computer) opens it, not
  just the rego or name; the row tints under the mouse. One change in the
  shared list piece, so every list has it. Push notifications added to the
  roadmap (Phase 5, with the email reminders).

## Next
Phase 2 slice 3 — Renters (docs/plans/phase-2.md). Plan first.

## Open items
- **Before launch: docs/launch-checklist.md** (relaxed admin sign-in, full
  security review, production settings, legal).
- Production buckets (before go-live): set the bucket clean-up rule for
  old copies to 7 days, not 30, so deleted files are gone ~30 days after
  deletion. See docs/legal-notes.md.
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
  entirely for Admins (confirmed by Abhi, 30 Oct 2026: not adding it).
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
