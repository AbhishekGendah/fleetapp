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
- Phone feedback (from Abhi's wife's test): a back arrow at the top of
  every page below a main section (stays put on a phone); the phone's back
  button now closes pop-ups, the camera and the new in-app photo viewer
  instead of leaving the page, and switching car tabs no longer piles up
  in the back history. Photos and image papers open full screen in the app
  (swipe, arrows, ✕, "Open to save or share"). Buttons have outlines and
  icons, risky ones in red; each card's main Add button is solid and full
  width on a phone. Car tabs are icon tiles on a phone, pills on a
  computer. Renewals, policies, costs, documents and readings show as their
  own small cards. New shared pieces: PageHeader, RecordList/RecordItem,
  ImageViewer, a "danger" button style, icons on buttons (packages/ui +
  catalogue). lucide-react added to packages/ui and the admin app (already
  used by the Operator app). Checked at 375px against a local copy of the
  app with test data.

- **Phase 2 step 3, part 1 — Renters** (plan:
  docs/plans/phase-2-step-3.md): Renters in the menu; a list (search,
  status filter, export logged); Add/Edit with name, preferred name, phone or
  email (one needed), date of birth (16 or older), home and postal address
  (Google search, "same as home"), emergency contact; a Renter page with
  "Still needed before renting", a note for other Renters sharing a phone or
  email, Status (Do not rent needs a private reason), Archive/Restore and a
  Log that never shows the details themselves. Migration 0018: `renters`,
  forced row-level security, no deletes, no admin access (tested). Shared
  pieces pulled out on the way: the Log card, the "Save status" ending and
  list exports.

- **Phase 2 step 3, part 2 — licences:** a Licence tab with the licence
  (issued in a state or overseas with its country, number tidied as typed,
  class, type, expiry) in a pop-up, refused if another Renter has it
  (archived ones included, with a link); front and back scans (camera or
  file) in the identity storage, no previews, every View logged; the
  licence expiry badge on the page and a Licence column on the list (search
  by licence number); Settings → Renters "Due soon" days; "Still needed
  before renting" now puts the licence first and treats an expired licence as
  missing. The Log names files by what they are ("Licence scan opened").
  Migration 0019: licence columns with checks and a one-licence rule, the
  scan file kind with a two-column link to its Renter and one scan per side.
  Shared pieces on the way: one "Due soon" settings form, record-upload steps,
  the pop-up form frame and file link moved to shared components.

- **Phase 2 step 3, part 3 — notes and access requests:** a Notes tab
  (several lines, facts-only hint, newest first with who and when, Remove
  note keeps it on record); "Download everything we hold" on the Details tab:
  one Excel file with Details, Licence, Notes, Licence scans and the full
  Log, each download logged. Migration 0020: `renter_notes` (forced row-level
  security, never edited or deleted, no admin access). The Log now includes
  notes. Shared on the way: several-sheet Excel files in core.

- **Phase 2 step 4, part 1 — Renter links, sending and the code** (plan:
  docs/plans/phase-2-step-4.md): a "Details form" card on the Renter page
  (Send details form, Copy link shown once, Send again, Cancel link,
  Expired/Locked); the link page at `/r/<secret>` asks a new phone for an
  emailed 6-digit code (10 minutes, 5 tries then locked, 3 codes an hour) and
  remembers the phone; until then it shows only the business name and a
  masked email. Emails from the Operator's name with reply-to the Operator.
  Settings → Renters: how many days links last (7). Migration 0021:
  `renter_links`, `renter_link_devices`, a reply-to on the test inbox, and the
  one narrow function that finds a live link from its fingerprint.

- **Phase 2 step 4, part 2 — the form the Renter fills in:** once the phone
  is confirmed, the link shows a privacy notice naming the Operator, then a
  phone-first form: their details as on file to correct, date of birth and
  home address needed, the licence typed fresh (never shown back), and photos
  of the front and back (camera or file, shrunk on the phone, identity
  storage; a new photo replaces the last; only "Added" is shown). Address
  search works on the form, 50 per link. What is typed is kept on the phone
  until sent. "Send to (Operator)" needs both photos; then "Thanks, (Operator)
  will check your details", also on every later visit. Nothing on the record
  changes; the Renter page's Details form card shows "Waiting for your
  review". Migration 0022: `renter_submissions` (one waiting per Renter),
  submitted licence photos on `files` linked to the link and the submission,
  and the link's address-search count. Shared on the way: the Renter details
  boxes, licence boxes and Take photo / Choose file buttons are now one piece
  each, used by the Operator's forms and the link. Fixed in passing: the
  licence number's "Required" now shows even before "Issued in" is chosen.

- **Privacy policy template for Operators (draft):**
  docs/legal/renter-privacy-policy-template.md, written from the OAIC's APP 1
  guidance and what the app actually holds, with placeholders and notes for
  the Operator. One lawyer review before launch (decided with Abhi: draft
  ourselves, review once).

- **Phase 2 step 4, part 3 — the Operator's review:** "Waiting for review"
  badge and filter on the Renters list; a Review button on the Details form
  card; the Review page shows every detail "on file → sent" with changes
  highlighted, and the two photos behind View (logged). **Approve** copies the
  details and licence in exactly as an edit would (refused if another Renter
  has the licence, with a link) and the photos become the licence scans (old
  ones to the bin). **Send back** with a note: emailed to the Renter (no link
  in the email: only fingerprints are kept, so they use the one they have);
  their link shows the note with what they sent filled in, and their photos
  stay added. Needs a working link (otherwise "send a new link first"). The
  daily clean-up removes never-approved submissions 30 days after their link
  ended, photos to the bin. Migration 0023: the grant that turns photos into
  scans, and two narrow database functions for the clean-up (the app still
  cannot delete anything itself). Shared on the way: one route helper for
  opening licence images, the in-transaction steps for saving details and a
  licence, and the licence-on-file message.

- **Phase 2 step 5 — retention** (plan: docs/plans/phase-2-step-5.md):
  licence scans go to the bin 12 months (Settings → Renters, 1 to 60) after
  the later of being added and the Renter's last rental, never while a
  rental, fine or dispute is open (hooks ready for Phases 3 and 4); the
  Licence tab shows "Kept until about (date)" and says when the timer deleted
  one. Everything a Renter sent through a link (approved too) is removed 30
  days after the link ended; scans made from it stay. "Download everything we
  hold" has a "Sent through link" sheet. All in the nightly clean-up, safe to
  re-run. Migration 0024: the narrow function that finds Operators with old
  scans, the wider submission clean-up, and one column grant. Shared on the
  way: the settings form now takes days or months; one "bin as System" step.
  Fixed on the way: approved photos could have looked like unsent link photos.

- **Full code review** (docs/reviews/2026-10-31-full-code-review.md), then
  group A fixed (security and personal data): link code lock counted over
  the link's life (10), pasted codes fixed, links stop on approval, archive,
  email change, lock or suspension; sign-in attempts claimed before the
  password is checked (no burst guessing); clean-up functions clamp their
  own cut-offs; admin reads only who/what/when of history; production
  refuses the test inbox and codes left email subjects; uploads go to a
  holding address and only checked bytes move on, confirmed only by their
  uploader, without races; address lookups on links fully capped; the phone
  draft keeps less; both apps refuse being framed. Migration 0025. Also fixed:
  the Review button that part 4c had missed.

- **Code review group B** (things that break or mislead): CI now builds both
  apps (as Vercel does, after a test-inbox check stopped deployments for a
  while) and checks formatting, and migrations run only after CI passes;
  friendly error and not-found pages; no upload stuck on Sending; retention
  fixes (year on Kept until, months recorded with timer deletions, reason in
  the Log, holds required, month ends, migration 0026 backfill); photos sent
  through links in the everything-held download and the Log; a warning before
  lowering how long scans are kept; a failed link email still shows the link;
  the database pool survives Neon closing idle connections; the nightly run
  works in parts and batches; downloads in local time and no apostrophes in
  Excel; re-saving a sale in the repeated daylight-saving hour keeps its
  time; settings store only what was changed; the sign-in hard limit applies
  to the login system's own endpoints; the first Admin is created under a lock.

- **Code review group C** (rules, accessibility, tidy-up): Settings number
  boxes take digits only; required notes and asterisks on the status forms,
  licence photos and document uploads; hints and refusals read out by screen
  readers; Retake waits while a photo sends; Tab in an address box keeps what
  was typed; filter dropdowns wait for Enter; small links get 44px; "Rego
  expires" column; DoTDirect only for WA; policies can be restored; repeated
  code merged (tabs, photo slots, nightly loop, messages). Migration 0027:
  submissions hold the same rules as Renters and must use their own Renter's
  link; identity files must be in identity storage; history can't be wiped
  in bulk or written as someone else; clean-up indexes; two new guard tests.
  Also: secret helpers kept out of browser code, health check answers 503
  when the database is down, accented makes ("Škoda") match, next year's
  models allowed from midnight on 1 January, download names always safe.
  Put off: a shared sign-in rate limit (launch checklist).

- **Library swap** (docs/plans/library-swap.md, approved): every hand-built
  piece an established library does, swapped. Browser tests first
  (Playwright on the admin app against a throwaway database, in CI), which
  found four real gaps, all now fixed. Then: dates on date-fns, phones on
  libphonenumber-js, the country list, device names (Bowser), file types
  (file-type), CSV (Papa Parse), typo suggestions (Fuse.js), the
  breached-password check from Better Auth, photo shrinking (Compressor.js),
  the photo viewer (yet-another-react-lightbox, with zoom), pop-ups and
  searchable boxes on Base UI, the code box on input-otp, forms on React
  Hook Form, lists on TanStack Table and nuqs (search without a page
  reload), money and formatted boxes on react-number-format. Kept native on
  purpose: dropdowns and tick boxes. Behaviour changes: Tab in the make box
  keeps what was typed; CSV puts quotes round escaped text. A local
  database now uses the standard Postgres driver (tests only).

- **Finishing the swap properly** (plan stage 9): a third-party licences
  file built with each app; the Google Places address is a setting
  (GOOGLE_PLACES_API_URL); the suggestion box in the catalogue; the make box
  opens on tap again (lost in stage 5); browser tests for the Operator app
  (invite and authenticator, a car with a photo and a document, a Renter
  and their link) on LocalStack and a Places stand-in, sharing one toolkit
  (@fleetapp/e2e); axe-core checks on every page, which found too-faint
  greys and reds, now darker; four more forms on the shared helper; a
  JavaScript download budget per page; Renovate settings; CLAUDE.md rules
  32 (libraries first) and 33 (every screen proven in a browser). Fixed on
  the way: test databases left a Docker volume each (25 GB); the admin build
  failed for a while (no public folder) and new settings were missing from
  the apps' turbo.json (APP_STAGE too); both fixed, CI green.

- Abhi added GOOGLE_PLACES_API_URL (config) to the web Vercel project and
  installed Renovate (Renovate only, scan and alert). Renovate's Dependency
  Dashboard is GitHub issue #3; update pull requests start on Mondays.

- The licences file is now built by reading the installed packages, not
  pnpm's listing, which failed on Vercel's cached installs (it needs pnpm's
  download store). It lists only what ships: 199 libraries for the Operator
  app, 173 for admin.

- Phase 3 slice 1 — bookings (plan: docs/plans/phase-3.md):
  - Migration 0028: `rentals`, `rental_rates` (append-only) and `car_holds`.
    The database refuses two holds on one car that overlap (exclusion rule;
    back-to-back allowed; ongoing = no end), refuses a status move that
    skips a step, and refuses any change to a rental's copied settings.
    Row-level security on all three; the admin app gets nothing (tested,
    and the "no Renter data" guard now covers rental tables).
  - Booking code: create as a draft or a booking, book a draft later
    (checked again under its own settings), cancel with a reason (car
    freed). Booking problems refuse (Do not rent, car sold or written off);
    handover problems are allowed, logged, and listed on the rental page.
  - Screens: Rentals in the menu, Rentals list, New rental form, rental
    page, Rentals tab on cars and Renters, calendar (month grid on a
    computer, list on a phone), Settings → Rentals.
  - New shared pieces: date-time picker (React Aria), record picker (Base
    UI), bookings calendar (FullCalendar, free views). New libraries
    pinned: react-aria-components 1.22.1, @internationalized/date 3.12.4,
    @fullcalendar/react 7.1.3, temporal-polyfill 1.0.6.
  - Browser tests for the whole booking flow, phone width, keyboard, and
    axe on every new page. Checklist rows O-225 to O-237 and A-60.

- Licence scans and rentals: the nightly clean-up, the "lowering deletes
  N scans" warning in Settings and the Licence tab's "Kept until" now all
  use rentals. A Renter with any rental not yet closed (draft, booked, out,
  or returned with the bond still held) keeps their scans; afterwards the
  timer counts from their last return. Tested with real rentals.

- Phase 3 slice 2 — contract templates and issued documents:
  - Migrations 0029 and 0030: contract_templates (one default per kind),
    contract_template_versions and issued_documents, both append-only; an
    issued document's PDF can never be binned or swapped once confirmed.
  - Templates: written in a TipTap editor (headings, lists, bold, italic,
    underline, dividing line) with Insert field for 27 merge fields; links,
    pictures and code can't be added. Saving a change makes a new version.
    Starter template: layout and headings only, no legal wording.
  - PDFs made on the server with react-pdf: the business's logo (PNG or
    JPEG; WebP logos are left off), page numbers, a red "Preview" notice.
    Template preview (fields shown by name) and a filled-in preview on each
    rental, listing details not on file. Issuing (store once, SHA-256,
    numbered versions) is built and tested, used from slice 3 (signing).
  - Screens: Settings → Contracts (list, add, editor, versions, Log),
    Contract card on rentals. Browser tests, axe, budgets.
  - New libraries pinned: @tiptap/react, @tiptap/pm, @tiptap/starter-kit,
    @tiptap/core 3.32.0; @react-pdf/renderer 4.9.0.
  - Known limit: PDFs use the built-in Helvetica, which covers English and
    Western European accents only. Names in other scripts need an embedded
    font; a font's licence (usually SIL OFL) is outside rule 32's list, so
    that is Abhi's decision when it matters.
  - Fine admin fee merge field comes with fines (Phase 6).

- Phase 3 slice 3 — signing the contract on the Renter's phone:
  - Migration 0031: a "sign contract" link purpose; a signing link names
    its rental, the template version and the fingerprint of the filled-in
    text it was sent for; one live signing link per rental; signing
    evidence (append-only, web only, never in the log).
  - Operator: the rental's Contract card sends the contract for signing
    once nothing is missing, shows the link waiting (Send again, Cancel
    link) and, once signed, "Contract signed" with the signed PDF.
    Cancelling a rental cancels its signing link.
  - Renter: code → their details → the whole contract → two ticks → draw
    (signature_pad) or type their name → signed. The code, opening the
    contract and signing are recorded with time, internet address and
    browser. If the rental or template changed since sending, signing is
    refused. The signed PDF has the signature and a signing record page,
    is issued for good (SHA-256) and emailed to the Renter and the
    business. The link is then used up.
  - New shared pieces: signature pad, contract reader (rendered on the
    server, nothing extra downloaded). Libraries pinned: signature_pad
    5.1.4, @tiptap/static-renderer 3.32.0.
  - LocalStack honours the "never overwrite" save: the full browser test
    issues a real PDF through it.
  - Browser tests for the whole flow at phone width with axe; the signing
    page budget is 445 KB. Checklist rows O-247 (updated), O-248 to O-259,
    A-62 and A-63.

- Phase 3 slice 4 — bonds (recorded by hand; Stripe collection is Phase 4):
  - Migration 0032: bond_movements (received, refunded, deducted,
    correction) with a generic payment method type (cash, bank transfer
    now; card and direct debit later). Never changed or deleted; a
    correction cancels one entry exactly, once; the database refuses
    anything that would leave less than nothing held. Web app only.
  - Rental page: Bond card (required, held, still to receive, entries),
    Record bond received (amount, how, day, reference in capitals),
    Correct on each entry. More than the rest of the bond is refused.
  - Before handover lists a short bond when the rental was made with
    "Bond required before handover" on. The block and override come with
    the handover (slice 5).
  - Bond entries in the rental's Log (amount, kind and how only).
  - Checklist rows O-260 to O-265.

- Phase 3 slice 5 — handover on the Operator's phone:
  - Migration 0033: inspections (handover and return checklists),
    damage marks, possessions (the database refuses two possessions of one
    car that overlap), checklist photos linked to their checklist, the car
    status Rented. A finished checklist, its marks and photos can never be
    changed. Web app only.
  - Rental page: Handover card (start, continue, cancel; once done, the
    report). Checklist page at phone width: photos on the list, kilometres
    (never below the car's last reading), fuel, keys, accessories, notes,
    damage on a car outline (tap, or choose the area), and the Renter's
    signature on the phone; a reason is needed if the bond is short.
    Acceptance needs the contract signed and no licence or car problems.
  - On acceptance: the report PDF (with small copies of the photos and the
    signature) is fixed and emailed; the rental is Active, possession
    starts, the car is Rented, its kilometres recorded.
  - Poor signal: the page opens with no signal once visited; photos and
    marks wait on the phone and send themselves. New libraries: dexie
    4.4.7, serwist and @serwist/turbopack 9.5.13, esbuild 0.28.2.
  - Settings → Rentals: the handover photo list (8 by default).
  - Found and fixed on the way: the Renter's Licence tab failed to open
    (since the scan retention fix on 1 Nov); now covered by the handover
    browser test.
  - Browser tests for the whole handover at phone width, with no signal
    part way; handover page budget 730 KB. Checklist rows O-266 to O-276
    and A-64.
- Demo data for testing (2 Nov 2026): Settings → Demo data, shown only on
  the test site (never when APP_STAGE is production, and only while email
  goes to the test inbox). One button fills the signed-in business, step by
  step, with 50 cars (DEMO01 to DEMO50: mixed makes, years 2016 to 2025,
  states, statuses, rego current, due soon, expired, direct debit and none,
  four insurance policies, purchases, costs, a photo each), 40 Renters
  (licences from several states and overseas, provisional, expiring and
  expired, made-up scans, notes, do-not-rent, archived, details forms sent)
  and 34 rentals (14 out now with their handovers done in the past, 2 of
  them overdue; 10 booked; 6 drafts; 4 cancelled; bonds full, part and
  corrected; contracts marked as demo, and some sent for signing). Made
  through the app's own code, so every rule and log applies. Pressing again
  adds only what is missing. Database and browser tests cover a whole run. Checklist rows O-277 to O-279.

- Dashboard, fleet at a glance and a calmer calendar (2 Nov 2026, plan:
  docs/plans/this-week.md), asked for by Abhi for fleets of ~100 cars on
  long rentals. No schema change.
  - Home: New rental / Add a car / Add a Renter; Needs attention (overdue
    returns, late pickups, this week's bookings not ready and why, Renter
    details to review, rego or insurance due, licences due of Renters
    renting, late back from the workshop); Today and this week; Fleet
    (counts by status that open the cars list, idle cars longest first).
  - Cars list: status counts above it; a Now column (who has the car and
    since when, or how many days it has sat idle).
  - Calendar with all cars: only pickups and returns; one car: its rentals
    in full.
  - New shared piece: count links (in the component catalogue).
  - Tests: date rules in the Operator's timezone (core), every dashboard
    list against the demo business plus another Operator seeing none of it
    (database), and the dashboard, cars counts and calendar in the browser.
    Checklist rows O-280 to O-285, A-65; O-236 updated.
  - Later: a one-row-per-car fleet timeline (DayPilot Lite, Apache-2.0, a
    candidate) once Abhi has used the dashboard.

- Phase 3 slice 6a — the return (plan: docs/plans/phase-3-slice-6.md):
  - Migration 0034: a return can record that the Renter was not there.
    New setting: "Must the Renter sign when the car comes back?" (off).
  - Rental page: Return card (start, continue, cancel; once done, when and
    Open return report). The handover and return cards share one piece.
  - Return checklist on the phone (same page pieces as the handover, so
    it also works with no signal): the handover's photo beside each slot,
    its fuel beside the fuel box, its damage greyed and lettered on the
    outline; new damage numbered in red, each with a photo.
  - Last step: the return time (now, or the real time of an after-hours
    drop-off; never before the handover or in the future), where the car
    goes next (Available, In service or Off road with reason and date),
    and the Renter's signature or "not here". Loaded only once the
    checklist is complete, so the page stays light.
  - Finish return, in one go: report fixed and emailed (photos side by
    side, kilometres driven, fuel then and now, new damage), possession
    ended at the return time, rental Returned, the car's booking hold
    released (an early return frees it), car status and kilometres set.
  - Bond card: "Held until" (return day plus the rental's bond hold days).
  - Demo data: three returned rentals (R35 early, R36 late with new
    damage, R37 after hours with the Renter not there, car to service).
  - Tests: return rules (core), checklist return rules (database), the
    whole return on the server, and on a phone in the browser. Return page
    budget 800 KB. Checklist rows O-286 to O-293 and A-66.
  - Found and fixed on the way (handover too): a photo taken of a damage
    mark while the mark itself was still sending waited up to 15 seconds,
    and meanwhile the mark read "Not taken". It now goes straight after,
    and reads "Waiting to send". Checklist photos keep their size while
    loading, so the page no longer jumps.

- Phase 3 slice 6b — damage records and insurance claims (plan:
  docs/plans/phase-3-slice-6b.md):
  - Migration 0035: damage_records and insurance_claims (RLS forced, each
    link checked within the business, one record per return damage mark,
    one claim per record, amounts in whole cents, never negative; archived,
    never deleted). Photos can belong to a damage record.
  - Each new damage mark at a return becomes an open damage record inside
    the return itself, under that rental and Renter.
  - Car Damage tab (open first) with Record damage for anything found
    another way. Damage page: where on the car, photos, who had the car
    (suggested from possession that day, confirmed by the Operator),
    status (Open, Repaired, Not repairing with a reason), the insurance
    claim (policy and excess from the car's policy that day, claim
    number, status, dates, amount paid out), Remove for hand-recorded
    ones, and the Log.
  - Rental page Damage card; dashboard "Damage open" and "Claims under way".
  - Demo data: new damage on R35 and R36's returns, two found later
    (DEMO03 while out, DEMO38 between rentals), claims lodged, declined
    and paid. On a business whose demo returns ran before today only the
    two found later appear.
  - Tests: claim form rules, damage from a return, the possession
    suggestion, claim defaults, another Operator refused (server and
    database), and the whole flow on a phone in the browser. Damage page
    budget 435 KB. Checklist rows O-294 to O-303; O-278 updated.

- Phase 3 slice 7a — changes of terms (plan: docs/plans/phase-3-slice-7.md):
  - Migration 0036: rental_changes (each change with before and after,
    reason and status; only the status moves on and the signed form is
    added once; never deleted; one rate change waiting at a time). Signing
    links can be for a change (sign_change).
  - Rental page Changes card: change or set the end date (the car's hold
    moves with it; refused if it runs into the next booking), make it
    ongoing, and change the weekly rate. An ongoing rental given an end
    with less notice than its terms is allowed and marked Short notice.
  - A rate change is emailed to the Renter as a change of terms to sign,
    and becomes the rate only once signed. Send again, withdraw, open the
    signed form. The Renter's signing page signs a change as it does the
    contract (one shared signing path).
  - Settings → Contracts: a Change of terms template starts from its own
    layout; new "Change of terms" fields.
  - Found and fixed on the way: the contract card's link status and
    Cancel link looked at any signing link of the rental, so they would
    have picked up a change's link.
  - Demo data: R03 extended two weeks; R05 with a rate rise waiting.
  - Tests: change rules (core), the table's rules and isolation
    (database), end and rate changes with holds and signing (server), and
    the whole flow on a phone in the browser. Rental page budget 480 KB.
    Checklist rows O-304 to O-310; O-278 updated.

- Phase 3 slice 7b — car swaps (plan: docs/plans/phase-3-slice-7.md):
  - Migration 0037: car_swaps (old and new car, reason, the two
    checklists, the signed form; one under way per rental; kept for good
    once finished). The rental's car can only change through its swap.
  - Rental page Car swap card: Swap car (only Available cars that are free
    for the rest of the rental), then Continue swap or Cancel swap while it
    is under way, and finished swaps with Open swap form. The rental's own
    return waits while a swap is under way.
  - Swap step 1: the car handed back, checked as a return beside its
    handover. Step 2: the new car's photos, kilometres, fuel, keys and
    damage, then where the old car goes and the Renter signs on the phone.
    Both checklists keep working with poor signal.
  - Finishing issues three documents (swap form, return report for the old
    car, handover report for the new one), emailed to the Renter and you,
    and moves possession, the car holds, both cars' statuses and the
    rental in one go.
  - Settings → Contracts: the Car swap form template has new "Car swap"
    fields (old car, new car, when, why).
  - Demo data: R04 swapped from DEMO04 (to the workshop) into DEMO37.
  - Tests: the table's rules and isolation (database), start, cancel and
    finish (server), and the whole swap on a phone in the browser. Swap
    page budget 730 KB. Checklist rows O-311 to O-316; O-278 updated.

- Fleet timeline (plan: docs/plans/this-week.md, section 4):
  - Rentals → Timeline: one row per car (sold and written-off cars left
    out), four weeks across from this week, each booked or out rental a
    bar that opens it. Earlier, This week and Later move a week at a time,
    never before this week (rentals already back are no longer held, so
    past weeks would look empty). On a phone it swipes sideways.
  - Built on DayPilot Lite's Scheduler (Apache-2.0), pinned at 6.1.0
    (6.2.0 is under 14 days old). Read only: no dragging. Its bars are not
    reachable with Tab on their own, so each bar is a plain link, read out
    with its dates; the accessibility check passes with no exceptions.
  - Booking colours now live in one shared file for the calendar and the
    timeline. Added to the component catalogue.
  - Tests: the week rules on the Operator's clock (core), the page on a
    phone with the keyboard, accessibility and a 310 KB budget (browser).
    Checklist rows O-317 and O-318.

## Next
Phase 3 is complete. Next: Phase 4 (payments).
Open idea: trim the phone rules to Australia only with libphonenumber's
metadata generator (about 40 KB off each form page); running the
generator needs Abhi's say-so.

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
