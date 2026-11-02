# Phase 3 slice 6b: damage records and insurance claims

Status: approved and built 2 Nov 2026. Design: docs/design/05 (damage and
incident records), 02 (excess pre-fills damage recovery), 06 (damage and
excess charges: Phase 4). Follows 6a, where new damage is marked at the
return.

Goal: every bit of damage on a car has one record (what, when, who had
the car, photos), and the insurance claim for it, if any, is tracked
through to the end.

## What the Operator sees

- **A Damage tab on each car:** its damage records, open first: date
  found, description, who had the car, status, claim status. "Record
  damage" adds one found any other time (a walk-round, a Renter's report,
  a car park bump).
- **Damage record page:**
  - What: date found, description, where on the car (the outline, as at
    the checklists), photos (taken there, or the return's photos shown).
  - Who had the car: worked out from possession on the date found (rule
    15), shown as a suggestion the Operator can confirm or clear; from a
    return it is that rental's Renter.
  - Status: Open, Repaired, Not repairing (with a note). Edits logged.
  - Insurance claim (optional, one per record): insurer and policy (the
    car's policy on that date, chosen for you), claim number, status
    (Not lodged, Lodged, Approved, Declined, Paid, Withdrawn), excess
    (filled in from that policy, can be changed), lodged and settled
    dates, amount paid out, notes.
- **From a return:** each new damage mark becomes an open damage record
  automatically, linked to the rental, the Renter and the return's photos.
- **Rental page:** a Damage card listing the records from its return.
- **Dashboard:** "Damage open" and "Claims under way" lines in Needs
  attention.

No money moves yet: recovering the excess or a repair from the Renter is a
Phase 4 charge on the ledger. The record keeps the amounts so Phase 4 can
charge from them.

## Build steps

- **6b.1 Core + DB:** damage and claim rules (statuses, which moves are
  allowed, amounts in whole cents, never negative), migration 0035:
  `damage_records` and `insurance_claims` (operator_id NOT NULL, RLS
  enabled and forced, archived not deleted, rule 13), files can belong to
  a damage record, the return's damage marks link to their record.
  Database tests: Operator A cannot see B's damage or claims; one claim
  per record; amounts never negative.
- **6b.2 Server:** create from a return (inside the return's transaction),
  record found damage, who-had-it lookup from possession, update status,
  add/update the claim with excess from the policy, photos; every change
  logged (rule 19). Tests including the possession lookup.
- **6b.3 Screens:** car Damage tab, record page (outline, photos, claim
  form with money boxes, rule 31), rental Damage card, dashboard lines;
  browser tests at phone width, accessibility, budgets.
- **6b.4 Demo data:** damage records for the demo returns, one found later,
  claims at different stages. Checklist rows, legal notes, progress.

## Self-review

- **Tenancy:** both tables carry operator_id with two-column links to car,
  rental, Renter and policy (so a record can never point at another
  business's car); RLS for the app's role only; admin gets nothing (rule 5).
- **Possession match:** the suggestion uses the same possession records
  fines will use; it is only a suggestion, confirmed by the Operator,
  never a charge.
- **Money:** excess and payout as integer cents (rule 9); no GST on them
  here, as nothing is charged yet; Phase 4 decides the charge's GST.
- **Immutability:** a finished return's marks stay as they were; the
  damage record that follows from one is a separate, editable record.
- **Edge cases:** damage found on a car with no possession that day
  (between rentals) leaves "who had it" empty; a car with no current
  policy leaves insurer blank to type in; a record from a return cannot
  be removed, only marked Not repairing; claims on archived policies stay
  readable.
- **Privacy and law:** claim numbers and insurer notes are business
  records, not identity documents; telling a Renter about damage they are
  charged for is Phase 4 (consumer law notes go there).
