# Shared Services

## Alerts
- A daily job builds one alert list per Operator. Each alert links to
  its record; statuses: open | snoozed | done.
- Types: rego/insurance expiring, service due, licence expiring, fine
  deadlines, failed payments, arrears, overdue returns, bonds due for
  refund, unsigned contracts before start, pending renter approvals,
  unverified odometer readings.
- Operator notified in-app always, a daily email summary at 7am
  (Operator timezone), and immediate email for urgent items (failed
  payments, fines due within 2 days).

## Renter messages
- Types: signing links, identity codes, invoices, receipts, failed
  payment notices, fine notices, rental ending in 7 days, licence
  expiring, bond refunded.
- Email by default; SMS for failed payments, signing links and identity
  codes.
- Templates editable per Operator. Sender name = Operator business
  name. Reply-to = Operator's email.
- Every message sent is logged (proof of notice).

## Activity log
- actor type (user | admin | system | renter_link), actor ID, entity,
  action, before/after values, timestamp. Append-only.
- History tab on each vehicle, renter, rental and fine.

## Renter links
- Types: onboarding form, contract signing, booking view, card payment,
  swap / change-of-terms form, return photos.
- Booking view shows rental details, next payment, balance, ledger,
  invoices, and allows odometer submission (unverified).
- Token hash stored only. Expiring (signing: 7 days by default),
  revocable, resendable. One-time code on a new device. Never shows
  identity documents.

## Search, lists and exports
- Global search: rego, renter name, phone, licence number, invoice
  number, fine notice number.
- All lists use one shared component: sort, filter, export to CSV or
  Excel. Lists become cards on mobile.
- Reference numbers per Operator (e.g. R-0001, INV-0001). Invoice
  numbers never skip.

## Spreadsheet import
- Vehicles and renters. Downloadable template, preview, validation
  errors shown before anything is saved. Safe to re-run.

## File storage
- Rules 21 to 23 in CLAUDE.md apply.
- Separate private location for identity documents.
- Storage used per Operator is visible in the admin app.

## Operator settings (defaults)
- Daily alert email: 7am; urgent alerts immediately.
- Renter messages: failed payment by SMS + email; rental ending 7 days
  before; licence expiry 30 days before.
- Signing link expiry: 7 days.
- Reply-to: the Operator's email.
