# Roadmap

Build order for fleetapp. Every phase starts with a plan Abhi approves
before any code is written.

## Phase 1 — Foundation

### 1a
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

### 1b
- Operator settings.
- File storage (S3).
- Mobile app shell and shared list component.

## Phase 2 — Core records
- Vehicles (incl. rego, insurance, photos, documents, costs).
- Renters (incl. licence, self-onboarding, privacy/retention).

## Phase 3 — Rentals
- Bookings, calendar, double-booking prevention.
- Contract templates, signing.
- Handover/return reports.
- Possession records, swaps.
- Bonds.

## Phase 4 — Money
- Stripe Connect onboarding.
- Ledger.
- BECS mandates.
- Weekly charges, one-off charges.
- Failed payments.
- Invoices, receipts, statements.

## Phase 5 — Fleet operations
- Servicing.
- Odometer.
- Reminders engine.

## Phase 6 — Fines

## Phase 7 — Dashboard and reports

## Phase 8 — Commercial
- AGS subscription billing.
- Read-only mode.
- Spreadsheet import.
- Demo Operator.

## Phase 9 — Go-live hardening
- Security review.
- Backup restore test.
- Real-phone testing.
- Accessibility.
- Legal docs.
- Production Neon project.
- Vercel Pro.
- Postmark.
- Production S3.
- Switch to branches + PRs.
