# Platform and Operators

## Operator (the business)
- legalName, tradingName, abn (validate checksum), gstRegistered,
  gstRegisteredFrom, address, phone, email, logo (used on contracts,
  invoices, emails), state, timezone (IANA, e.g. Australia/Perth).
- Stripe: connected account ID, chargesEnabled, payoutsEnabled, BECS
  capability status.
- subscriptionStatus: trial | active | past_due | read_only | cancelled.
- All Operator settings from the other design docs live here, each with
  a default.

## User (the Operator's login)
- Exactly one per Operator in v1; separate table, 1-to-many ready.
- Email + password + TOTP 2FA (mandatory). Recovery codes shown once.
- Trusted-device session lasts 14 days.
- Email alert on sign-in from a new device.
- Temporary lockout after repeated failed attempts.
- Password reset by email.

## Onboarding a new Operator (v1: created by AGS)
1. Admin creates the Operator; an expiring invite email is sent.
2. Operator sets password and TOTP.
3. Setup checklist on their dashboard: business details; Stripe Connect
   Express onboarding; reminder to request higher BECS limits from
   Stripe; contract template; import cars and renters.
4. Payments are blocked until Stripe charges are enabled.

## Subscription (Operator pays AGS)
- Stripe Billing on the AGS platform account; status synced by webhook.
- Pricing model TBD (per vehicle, flat or tiers). Plans must be data,
  not code.
- Failed payment: 14-day grace, then read_only. Read-only = view and
  export only; no new rentals or contracts. Existing Renter weekly
  debits KEEP running (that money goes to the Operator).
- Cancel: Operator can export everything (CSV + all PDFs). Hard delete
  90 days after cancellation.
- Track SMS count per Operator (SMS cost handling TBD with pricing).

## Admin app (AGS only)
- Separate subdomain, separate Vercel project, admin_users table, TOTP
  mandatory, own DB credentials.
- Actions: create Operator + send invite; list Operators with status,
  Stripe status, subscription status, last login, storage used;
  suspend / reactivate; resend invite; reset TOTP (only after
  out-of-band identity check).
- Every admin action is logged. No access to Renter personal data.

## Demo Operator
- Seeded with realistic fake cars, renters, rentals, payments and fines.
- Runs on Stripe test mode. Used for sales demos.
