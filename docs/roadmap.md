# Roadmap

Build order for fleetapp. Every phase starts with a plan Abhi approves
before any code is written. Detail of what is built is in
docs/progress.md; what must happen before the first real Operator is in
docs/launch-checklist.md.

Status: ✅ done · 🔨 in progress · ⏳ not started. Last checked 1 Nov 2026.

## Phase 1 — Foundation ✅

### 1a ✅ (plans: docs/plans/phase-1a.md, slice-2/3/4)

- Platform tables, tenancy + RLS, migrations running automatically
  from GitHub.
- Admin login with TOTP, and safe creation of the first admin.
- Create/list Operators with invites.
- Operator invite acceptance: password + TOTP + recovery codes, sign
  in, 14-day trusted device, lockout, password reset, new-device
  alert.
- Placeholder dashboard.
- Activity log.
- Tenant isolation test.
- Email: a dev-only outbox viewable in admin behind an env flag,
  until a real provider is set up.
- Not done, moved: admin password reset (launch checklist).

### 1b ✅ (plan: docs/plans/phase-1b.md)

- Look and feel: PintoFleet brand, logo, app shell.
- Operator settings.
- File storage (S3).
- Mobile app shell and shared list component.
- Added: installable phone app (home-screen icon, install guide card).

## Phase 2 — Core records ✅ (plan: docs/plans/phase-2.md)

- Step 1 — Cars ✅: add, find, edit, archive, status.
  - Added: starting odometer reading on the add form, and odometer
    readings on the car page (taken early from Phase 5).
  - Added: the make and model list, kept by AGS on the admin site and
    shared by every Operator, with smart matching and a "Typed by
    Operators" page to fix individual cars.
- Step 2 — Car paperwork, costs, photos (plan: docs/plans/phase-2-step-2.md)
  - 2a ✅ Rego renewals, insurance (single-car and fleet policies),
    "due soon" badges.
  - 2b ✅ Purchase, sale (buyer and seller details, lodge-transfer
    reminder), other costs, Costs tab with totals. Transfer papers and
    receipts are uploaded in 2c.
  - 2c ✅ Photos and documents (incl. attachments for rego, insurance,
    receipts and purchase/sale transfer papers), in-app camera, photo viewer.
- Step 3 ✅ Renters (licence, licence scans, "do not rent", duplicates).
  Also narrows what admins can see in the activity log (rule 5).
- Step 4 ✅ Renter links and self-onboarding (details form, Operator review).
- Step 5 ✅ Retention (scheduled deletion of old licence scans).
- Full code review before Phase 3 ✅ (docs/reviews/2026-10-31-full-code-review.md).

## Library swap ✅ (plan: docs/plans/library-swap.md)

- Hand-built pieces replaced by established libraries, with browser tests
  (Playwright) proving each one. Done 1 Nov 2026.

## Phase 3 — Rentals ✅ (plan: docs/plans/phase-3.md; bookings, contracts, signing, bonds, handover, return, damage, changes of terms, car swaps and the fleet timeline built by 3 Nov 2026)

- Bookings, calendar, double-booking prevention.
- Contract templates, signing.
- Handover/return reports (must work offline-ish, rule 25).
- Possession records, swaps.
- Bonds.
- Car status "rented" and booking checks (age, licence class,
  provisional, expiry), held over from Phase 2.

## Phase 4 — Money ⏳

- Stripe Connect onboarding.
- Ledger.
- BECS mandates.
- Weekly charges, one-off charges.
- Failed payments.
- Invoices, receipts, statements.
- Profit per car (costs are already recorded from Phase 2).

## Phase 5 — Fleet operations ⏳

- Servicing.
- Odometer: readings exist from Phase 2; this phase adds readings from
  handover/return and service-due by km.
- Reminders engine (email reminders for rego, insurance, servicing;
  Phase 2 shows on-screen badges only).
- Push notifications on the phone for the same reminders, built with the
  reminders engine. Each User turns them on with "Allow notifications";
  on iPhone they only work from the home-screen app (Android works in the
  browser too). Email stays the backup, as not everyone allows them.

## Phase 6 — Fines ⏳

## Phase 7 — Dashboard and reports ⏳

## Phase 8 — Commercial ⏳

- AGS subscription billing (pricing model still to decide).
- Read-only mode.
- Spreadsheet import of cars and Renters.
- Demo Operator: a "Seed demo data" button (GitHub Actions, dev/staging
  only, refuses production) that makes a fresh demo business full of
  varied made-up cars, Renters and rentals. Discussed 1 Nov 2026; Abhi to
  say when. Open choice: a new demo business each run (recommended) or
  fill the existing "Fleet test" business.
- Support access, the Dayforce way (discussed 1 Nov 2026, to plan before
  more than a handful of Operators): AGS staff pick an Operator in admin,
  give a reason, and open their Operator app read-only, time-limited, with
  a banner, every page logged in the Operator's Log. Changes rule 5 (admin
  cannot read Renter data in v1), so it needs a plan, Operator terms and
  privacy policy wording, and the lawyer. Optional per-Operator "ask me
  first".
- Error tracking service (alerts, grouped errors, no personal data) before
  scaling: a new service, so a decision on which and where it stores data.

## Phase 9 — Go-live hardening ⏳

Works through docs/launch-checklist.md, including:

- Admin sign-in time limits restored (relaxed while testing).
- Full security review.
- Backup restore test.
- Real-phone testing.
- Accessibility.
- Legal docs (lawyer review).
- Production Neon project.
- Vercel Pro.
- Postmark.
- Production S3.
- Switch to branches + PRs (how it will work, agreed 1 Nov 2026): each
  feature on its own branch with a password-protected Vercel preview on dev
  data; Abhi tests there once; his approval merges to main; production gets
  that exact build. `main` protected (checks + approval). A permanent
  staging copy is optional at first, added when several features run at
  once or a demo site is wanted.
- Domain: pintofleet.com.au (plus pintofleet.au). app.pintofleet.com.au
  (Operator app), admin.pintofleet.com.au, staging.pintofleet.com.au and
  staging-admin.pintofleet.com.au; pintofleet.com.au itself for a public
  website later. Only settings change (APP_URL, ADMIN_URL, EMAIL_FROM),
  plus DNS, Postmark sending records, Google Places key and Stripe.

## Runs alongside every phase

- Abhi's test checklist (Google Sheet, link in docs/progress.md): every
  new or changed field, button and screen gets its row. Abhi has chosen
  to test everything in one go near the end, taking his time (1 Nov 2026).
- Legal check of each task, written to docs/legal-notes.md.

## Decided along the way

- No "remember this device" for Admins, ever (decided by Abhi, 30 Oct
  2026): an admin login reaches every Operator, so every admin sign-in
  asks for the authenticator code.
