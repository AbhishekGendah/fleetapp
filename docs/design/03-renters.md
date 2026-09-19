# Renters

## Renter
- fullName, preferredName, dateOfBirth, phone, email,
  residentialAddress, postalAddress, emergency contact (name, phone,
  relationship), dated internal notes.
- status: active | do_not_rent (with reason, private to the Operator) |
  archived. Never shared between Operators.

## Licence
- number, issuing state or country, class, expiry, cardNumber,
  type (full | provisional | overseas), front and back scans (stored as
  identity documents).

## Automatic checks
- At booking: minimum age, licence class suits the vehicle,
  provisional allowed per setting, not do_not_rent.
- Licence expiring during the rental: warn at booking, then reminders.
- Expired licence: handover is blocked.
- Duplicate detection by licence number or email: show the existing
  record.

## Self-onboarding
- Operator sends a link; the Renter enters details and photographs their
  licence on their phone; the Operator reviews and approves.

## Renter history screen
- Rentals and vehicles, balance, bond held, fines, documents, notes.

## Privacy and retention
- Identity documents: separate private storage, short-lived signed URLs,
  every view logged.
- Licence scans are auto-deleted a set time after the Renter's last
  rental closes, unless a fine or dispute is open.
- Name, licence number and financial records are kept (tax records must
  be kept 5 years).
- One-click export of everything held about a Renter.

## Operator settings (defaults)
- Minimum age: 21.
- Provisional licences allowed: no.
- Licence expiry warning: 30 days before.
- Licence scan retention: 12 months after the last rental closes.

## Later versions
- Identity verification against government records via a paid service.
