# Car changes from Abhi's testing (30 Oct 2026)

Status: waiting for Abhi's approval. The smaller changes (form clearing,
formatting, Log, Type) are already built; these need a plan because they
change the database or how money is recorded.

## 1. Monthly rego
WA Transport offers a one-month renewal by direct debit (and SA offers 9
months). Rego terms become 1, 3, 6, 9 or 12 months, shown as "Monthly (direct
debit)", "3 months" and so on. The cost entered is for that term. Migration:
widen the allowed terms in the database check.

## 2. How the insurance premium is paid
"Premium" is what the policy costs. Most are paid yearly, some by monthly or
fortnightly instalments. Add **Paid** (Yearly, Monthly, Fortnightly) next to
the premium; the amount entered is one payment, with its GST. The policy list
shows "$137.50 monthly". Later reports work out a yearly figure from it.
Migration: a `payment_frequency` column, existing policies set to Yearly.

## 3. Servicing as a cost type
Cost types become Servicing, Repair, Refurb, Other. Migration: add the value.
(Phase 5 adds service schedules; servicing costs entered now stay as they are.)

## 4. Pop-up forms for adding
Every "add" form on a car (rego renewal, insurance, cost, odometer reading)
becomes an "Add …" button that opens a pop-up. Saving closes it; the new
record appears in the list. On a phone the pop-up fills the screen. Purchase
and sale stay as a summary with an "Edit" button that opens the same kind of
pop-up. A new shared Dialog piece is added to packages/ui and the catalogue
first (rule 29).
Tradeoff: one more tap to start, but the page is much shorter and nothing
can be added twice.

## 5. Lower odometer readings refused
A reading lower than the last one is refused with "Lower than the last
reading (48,210 km). If that one was wrong, withdraw it first." A tick box,
"The odometer was replaced", allows it for the rare real case, and that is
written in the log.
Tradeoff: a typo in an old reading must be withdrawn first, which is the
right fix anyway.

## Formatting decisions (rule 31)
- Policy number: capitals only. Insurers each use their own pattern, so no
  fixed shape is enforced.
- Transfer reference: capitals only, same reason.
- Driver licence number: capitals and digits, no spaces, 10 at most (the
  longest Australian format).
