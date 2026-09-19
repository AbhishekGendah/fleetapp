# Rentals

## Rental
- renter, vehicle (current vehicle via possession), type (fixed |
  ongoing), plannedStart, plannedEnd (null when ongoing),
  actualHandoverAt, actualReturnAt, bondAmount, chargeDay, status,
  settings snapshot.
- Weekly rate history: each rate has an effectiveFrom date.

## Statuses
- draft: being set up; car not held.
- booked: car held; contract sent for signing; bond requested.
- active: contract signed AND handover acceptance signed; weekly
  charges start.
- returned: car back, return report done; charges stop.
- closed: final balance settled and bond refunded or deducted.
- cancelled: only from draft or booked.

## Fixed-term and ongoing
- Ongoing rentals hold the car with an open-ended range, blocking future
  bookings for that car until an end date is set (e.g. when the Renter
  gives notice).
- Extending: move the end date or convert to ongoing. Every change
  logged.
- Fixed-term past its end date without return: flagged overdue; charges
  continue.

## Changes during a rental
- Rate change: new rate row with effectiveFrom. Renter notice rules for
  changing a direct debit amount are TBD: confirm Stripe DDR
  requirements before building this.
- Car swap: same rental. Close possession on the old vehicle, open on
  the new one. The Renter signs a swap form. Return report for the old
  car, handover report for the new car.
- Early return: final charge follows the part-week setting.
- Changing terms on an active rental is an explicit change record,
  signed by the Renter where the contract requires, and logged.

## Possession records
- vehicleId, rentalId, renterId, startAt (signed handover acceptance),
  endAt (recorded return; null while current).
- Fine matching uses these. No overlapping possession per vehicle
  (enforced in the database).

## Operator settings (defaults, snapshotted on each rental, overridable
per rental at creation)
- Rent charged: weekly, in advance.
- Charge day: same weekday as the start (alternative: one fixed day for
  all).
- Part weeks (first week, early return): charged daily pro rata
  (alternative: full week).
- Bond: required before handover.
- Bond hold after return: 28 days.
- Notice period for ongoing rentals: 7 days.
- Overdue fixed-term: keep charging the same weekly rate.
