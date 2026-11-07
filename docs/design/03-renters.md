# Renters

## Renter

- kind: person | organisation (a business: company, partnership or
  trust). Fixed when added. Shown as "Person" and "Business"
  (docs/plans/business-renters.md).
- A person: fullName, preferredName, dateOfBirth, phone, email,
  residentialAddress, postalAddress, emergency contact (name, phone,
  relationship), dated internal notes, an optional ABN (a sole trader).
- A business: legal name (fullName), trading name, ABN (checksum), contact
  name, contact email (required) and phone, business address, postal
  address. No licence, date of birth or emergency contact.
- status: active | do_not_rent (with reason, private to the Operator) |
  archived. Never shared between Operators.

## Drivers

- A business's cars are driven by its drivers: person Renters linked to
  it (organisation_drivers). A driver who also rents on their own is the
  same record. A link is removed, never deleted; adding back is a new link.

## Licence

- number, issuing state or country, class, expiry, cardNumber,
  type (full | provisional | overseas), front and back scans (stored as
  identity documents).

## Automatic checks

- At booking: the Renter is not do_not_rent; the driver (the Renter
  themselves for a person) has the minimum age, a licence class that
  suits the vehicle, provisional allowed per setting, and is not
  do_not_rent.
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
- Licence scans are auto-deleted a set time after the last rental the
  Renter drove closes, unless a fine or dispute is open.
- Seven years after a Renter's last rental, time with a car or link to a
  business, their details are removed. A business rental's own records
  (signed reports, photos, typed names) go only once the business and
  every driver who had the car are past their seven years.
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
