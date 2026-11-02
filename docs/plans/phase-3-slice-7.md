# Phase 3 slice 7: changes during a rental

Status: approved 2 Nov 2026; 7a built 2 Nov 2026, 7b next. Design: docs/design/04 (changes
during a rental, possession), 05 (swap form and change-of-terms form are
templates), docs/plans/phase-3.md (slice 7). Rules 14, 15, 18 and 19 apply
throughout.

Already built in earlier slices, so not part of this one: overdue rentals
are flagged (dashboard and rental page), an early return frees the car
from the return time (6a), and cancelling works only from draft or booked
with a reason (slice 1).

## Split in two

- **7a: changes of terms.** Move or set the end date, switch between
  fixed-term and ongoing, change the weekly rate. Each is its own
  recorded change; a rate change waits for the Renter's signature.
- **7b: car swap.** The Renter swaps into another car during the same
  rental: a return checklist for the old car, a handover checklist for the
  new one, and the Renter signs the swap form on the phone.

7a first: it is smaller, reuses the signing link from slice 3, and the
swap in 7b builds on the change record it adds.

## 7a: what the Operator sees

- **Rental page, Changes card** (active or booked rentals): "Change end
  date", "Make it ongoing" / "Set an end date", "Change weekly rate", and
  a list of every change made (what, before and after, why, who, when,
  signed or waiting).
- **End date:** a new end in the future. Longer or shorter is allowed;
  the car's booking hold moves with it, and the database refuses an end
  that runs into the car's next booking (the message names that booking).
  For an ongoing rental being given an end, the app shows the notice
  period from the rental's settings and warns if the end is sooner; the
  Operator can go ahead, and the warning is logged.
- **Make it ongoing:** the end is removed and the hold runs open-ended,
  refused if the car has a later booking.
- **Weekly rate:** the new amount (money box) and the day it applies from
  (not before tomorrow). It is sent to the Renter as a change-of-terms form
  by a signing link (the same code-protected link and signing page as the
  contract). The new rate only takes effect once they sign; until then it
  shows "Waiting for signature", and it can be withdrawn. A signed form is
  fixed with its fingerprint (rule 12) and emailed to both.
- **End-date and kind changes** take effect at once (the Operator has
  agreed them with the Renter); "Send for signing" sends the change-of-terms
  form for them too, if the business wants it signed.
- **Change-of-terms template:** the Operator's default "Change of terms"
  template in Settings → Contracts, with new fields to insert: what is
  changing, the new rate and from when, the new end. With no such template,
  the buttons say so and link to Settings → Contracts.

## 7a: database (migration 0036)

- `rental_changes`: operator_id, rental_id, kind (end_date, rental_type,
  weekly_rate), the values before and after, applies_from, reason, status
  (applied, waiting_for_signature, withdrawn), the signed document when
  there is one, who made it. Append-only except for the status moving
  from waiting to applied or withdrawn (a trigger refuses anything else).
  RLS on and forced, web role only.
- Signing links get a new purpose `sign_change` and a link to the change.
- Rental end, kind and holds change only through these changes, in the
  same transaction, logged (rule 19). A weekly rate row (slice 1) is added
  only when its change is signed.

## 7b: what the Operator sees

- **Rental page, "Swap car"** (active rentals): choose the new car (only
  cars free from now to the rental's end, or open-ended for ongoing) and a
  reason (e.g. breakdown).
- **Swap checklist on the phone**, made of the existing checklist pieces
  (works with no signal, as the handover and return do):
  1. The old car as a return: photos beside its handover, kilometres,
     fuel, keys, new damage.
  2. The new car as a handover: photos, kilometres, fuel, keys, damage
     already there.
  3. Last step: where the old car goes (Available, In service or Off road
     with reason and date), then the Renter reads the swap form and signs.
- **Finish swap, in one transaction:** both checklists fixed; the old
  car's possession ends and the new one's starts at the Renter's
  acceptance (rule 15: no gap, no overlap); the old car's hold ends and
  the new car's starts; the rental's car becomes the new one; the old car
  gets the chosen status, the new car is Rented; both cars' kilometres are
  recorded; new damage on the old car becomes damage records (6b). The
  rental stays active. Three PDFs are fixed and emailed: the old car's
  return report, the new car's handover report and the signed swap form.
- **Rental page:** the swap in the Changes list with its three documents;
  the Return card then works on the new car.
- **Swap template:** the Operator's default "Car swap form" template, with
  fields for the old car, the new car and the swap time. Without one, the
  Swap car button links to Settings → Contracts.

## 7b: database (migration 0037)

- `car_swaps`: operator_id, rental_id, from and to cars, reason, status
  (in progress, completed, cancelled), the return and handover checklists,
  when it was accepted, the old car's next status. RLS on and forced.
- Checklists can belong to a swap. The rule "one finished handover and one
  finished return per rental" becomes "one of each outside a swap", so the
  rental's real handover and return stay unique while each swap adds its
  own pair.
- The rental's car can change only through a finished swap.

## Build steps

- **7a.1 Core + DB:** change rules (end in the future, notice warning,
  rate applies from tomorrow at the earliest, kind switches), new merge
  fields, migration 0036, database tests (Operator A cannot see B's
  changes; history cannot be rewritten; an end running into the next
  booking is refused).
- **7a.2 Server:** apply end and kind changes with their holds, rate
  change by signing link, withdraw, sign (fixed PDF, emails), tests.
- **7a.3 Screens:** Changes card and forms, signing page for a change,
  browser tests at phone width, accessibility, budgets.
- **7a.4 Demo data, checklist rows, docs, deploy.**
- **7b.1 to 7b.4:** the same four steps for the swap, with migration 0037.

## Self-review

- **Tenancy:** every change in withTenant with the session's Operator;
  both new tables carry operator_id with two-column links (a change or
  swap can never point at another business's rental or car). Admin sees
  nothing (rule 5).
- **Double booking (rule 18):** every hold change goes through the
  existing exclusion rule, so a longer end, an ongoing switch or a swap
  into a booked car is refused by the database, not just the screen.
- **Possession (rule 15):** a swap ends one possession and starts the next
  at the same moment, inside one transaction; the database already refuses
  overlaps, and the swap test proves fines match the right car either side.
- **Settings snapshot (rule 14):** notice period and photo list come from
  the rental's own settings, not today's.
- **Money (rule 9):** rates in cents with the date they apply from; nothing
  is charged in Phase 3. Phase 4 must confirm Stripe's notice rule for a
  changed direct debit amount (decision 5) before charging from a new rate.
- **Immutability (rule 12):** signed change-of-terms and swap forms, and
  both swap reports, are issued documents with fingerprints.
- **Edge cases:** a change while a return or swap is under way is refused;
  two rate changes waiting at once are refused (withdraw the first); a swap
  started then abandoned is cancelled and the old car stays out; shortening
  an end to before now is refused (use the return instead); the swap's new
  car sold or off road is refused.
- **Legal:** a rate rise mid-rental needs the Renter's agreement (consumer
  law: unfair contract terms if the business can change the price alone),
  hence the signature before it takes effect. The swap form records the
  Renter accepting the new car's condition, as the handover does. Both go
  in docs/legal-notes.md and on the lawyer list.
