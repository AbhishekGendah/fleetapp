# Car changes from Abhi's testing (30 Oct 2026)

Status: approved and built (30 Oct 2026). The smaller changes (form clearing,
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

## Follow-up: monthly direct debit and the expiry date (for approval)

**Monthly direct debit has no expiry.**
- Choosing Monthly (direct debit) hides the Expires box; the cost is the
  monthly amount ("$75.00 a month").
- While it is on, the car counts as registered: the Rego column and the
  car page show a green "Direct debit" badge instead of a date, and it never
  turns "Due soon".
- It stops when a fixed-term renewal (3, 6, 9 or 12 months) is added for
  the car, or with a "Stop direct debit" button (asks for the date it
  stopped, e.g. when the car is sold). Stopped ones stay in the list and
  the log.
- The sale form's transfer note adds "Cancel any rego direct debit in
  DoTDirect before the transfer", as WA Transport asks.
- Database (migration): `expires_on` may be empty only for a monthly
  renewal (checked by the database), plus a `direct_debit_stopped_on` date.
  The "current rego" lookup puts an active direct debit first.

**Expires fills itself in.**
- Choosing a term sets Expires to the current rego's expiry plus that term,
  e.g. current expiry 15 Nov 2026 + 6 months = 15 May 2027. With no
  current rego (or only a direct debit), it starts from today.
- Month ends are handled: 31 Jan + 1 month = 28 Feb (29 in a leap year).
- The date stays editable, for a lapsed rego or a car bought unregistered.
  Once you type your own date, changing the term no longer overwrites it.
- Tested: month-end and leap-year sums, the database rule, the current-rego
  choice with and without a direct debit.
