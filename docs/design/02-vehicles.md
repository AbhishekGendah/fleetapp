# Vehicles

## Vehicle
- rego, regoState, vin, make, model, variant, year, colour, bodyType,
  transmission, fuelType, seats.
- status: available | rented | in_service | off_road | sold |
  written_off.
- rented is set only by the system from active possession. Operators
  cannot manually set a rented car to available.
- in_service / off_road need a reason and expected return date. Warn if
  the car is currently rented.

## Rego
- One record per renewal: state, termMonths (3, 6 or 12), expiry, cost,
  paidDate, document. Reminders use the latest record.

## Insurance
- Policy: insurer, policyNumber, type (comprehensive | third_party),
  start, end, excess, cost, certificate.
- Many-to-many with vehicles (fleet policies). For profit reporting,
  policy cost is split evenly across covered vehicles.
- Excess is used to pre-fill damage recovery charges.

## Servicing and maintenance
- Service schedule per vehicle: intervalKm and intervalMonths, whichever
  comes first (default 10,000 km / 6 months). Next due is computed.
- Maintenance job: date, type (service | repair | tyres | brakes |
  inspection | other), odometer, workshop, cost (cents) + GST,
  description, invoice file, tyre positions for tyre jobs.
- Creating a job can set the vehicle to in_service in the same step.

## Odometer readings
- value, recordedAt, source (purchase | handover | return | service |
  renter | manual), isVerified.
- Renter-submitted readings are unverified until the Operator confirms.
- A reading lower than the previous one is flagged.
- Current km = latest verified reading.

## Photos and documents
- General photos and documents (rego papers, insurance, purchase papers,
  inspection reports). Handover/return photos belong to the rental but
  also appear in the vehicle history.

## Costs and profit
- Purchase: date, price, GST, sourceType (dealer | private; affects GST
  credit eligibility), seller, odometer at purchase.
- Refurb costs are added to the vehicle's cost base.
- Profit per vehicle = income (from the ledger via rentals/possession)
  minus costs (purchase, refurb, rego, insurance share, maintenance).
- Depreciation: out of scope for v1 (accountant's job).
- Sale: date, price, buyer. The vehicle is archived; history kept.

## History timeline
- One timeline per vehicle: rentals and possession, services, fines,
  odometer readings, status changes.

## Operator settings (defaults)
- Rego and insurance reminders: 30 and 7 days before expiry.
- Service interval: 10,000 km or 6 months (per-vehicle override).
- Flag lower odometer readings: on.
