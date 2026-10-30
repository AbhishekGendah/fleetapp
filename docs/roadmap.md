# Roadmap

Build order for fleetapp. Every phase starts with a plan Abhi approves
before any code is written. Detail of what is built is in
docs/progress.md; what must happen before the first real Operator is in
docs/launch-checklist.md.

Status: ✅ done · 🔨 in progress · ⏳ not started. Last checked 30 Oct 2026.

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

## Phase 2 — Core records 🔨 (plan: docs/plans/phase-2.md)
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
  - 2c ⏳ Photos and documents (incl. attachments for rego, insurance,
    receipts and purchase/sale transfer papers). **Next.**
- Step 3 ⏳ Renters (licence, licence scans, "do not rent", duplicates).
  Also narrows what admins can see in the activity log (rule 5).
- Step 4 ⏳ Renter links and self-onboarding.
- Step 5 ⏳ Retention (scheduled deletion of old licence scans).

## Phase 3 — Rentals ⏳
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
- Demo Operator.

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
- Switch to branches + PRs.

## Runs alongside every phase
- Abhi's test checklist (Google Sheet, link in docs/progress.md): every
  new or changed field, button and screen gets its row.
- Legal check of each task, written to docs/legal-notes.md.

## Decided along the way
- No "remember this device" for Admins, ever (decided by Abhi, 30 Oct
  2026): an admin login reaches every Operator, so every admin sign-in
  asks for the authenticator code.
