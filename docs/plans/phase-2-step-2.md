# Phase 2 step 2 plan — car paperwork, costs and photos

Status: waiting for Abhi's approval. Detail for step 2 of
docs/plans/phase-2.md. Built and deployed in three parts (2a, 2b, 2c),
each tested on the dev site before the next.

## 2a — Rego and insurance

### Rego renewals (`vehicle_registrations`)
One row per renewal: state, term (3, 6 or 12 months), expiry date, cost,
GST, paid date, and the rego paper (optional). The renewal with the
latest expiry is the car's current rego.

- Expiry and paid dates are plain dates (no time, so no timezone shift).
- An expiry before the previous renewal's is warned about, not refused.
- A wrong entry is archived (hidden, kept, logged), never deleted.

### Insurance (`insurance_policies` + `insurance_policy_vehicles`)
A policy: insurer, policy number, type (comprehensive or third party),
start and end dates, excess, cost, GST, and the certificate (optional).
One policy can cover many cars, and a car can be taken off a policy
(the link is closed, not deleted, so history shows which policy covered
the car when).

- Policies get their own list and page under Cars → Insurance, because
  a fleet policy is not any one car's.
- From a car's page: see its current policy, add it to a policy, or
  take it off.
- The excess is kept for later (damage recovery charges, Phase 3/4).

### "Due soon" badges and setting
- Car list gets "Rego" and "Insurance" columns showing the expiry date
  with a badge: amber "Due soon" inside the warning window, red
  "Expired", grey "None" when there is no record.
- New setting, Settings → Cars: "Warn this many days before rego or
  insurance expires", 30 by default (1 to 90). Stored in
  `operator_settings` with its default in code, as planned in 1b.
- Reminder emails come with the reminders engine (Phase 5); this is
  on-screen only.

## 2b — Purchase, sale and other costs

- **Purchase** (`vehicle_purchases`, one per car): date, price, GST,
  bought from a dealer or a private seller, seller's name, odometer at
  purchase. The odometer is saved as a reading dated the purchase day
  (source "purchase"). A private-seller purchase has no GST: the GST box
  is locked at $0.
- **Sale** (`vehicle_sales`, one per car): date, price, GST, buyer's
  name. Saving it sets the car to Sold and offers to archive it.
- **Other costs** (`vehicle_costs`, many per car): date, kind (refurb,
  repair, other), description, amount, GST, receipt (optional). Refurb
  counts towards the car's cost base for the profit report later.
- **Costs tab** on the car page: purchase, costs, and sale, with totals
  (calculated, never stored).

## Money rules (all of 2a and 2b)
- Every amount is whole cents, typed as dollars ("$1,234.56"). One
  shared, tested function turns typed dollars into cents and back.
- Every amount is stored including GST, with its GST stored next to it
  (rule 9). The GST box fills itself with 1/11 of the amount when "Price
  includes GST" is ticked, and can be changed, because some bills mix
  GST and GST-free items (rego is a mix: the fee has no GST, the CTP
  part does). GST can never be more than 1/11 of the amount, or negative.
- These are the Operator's own expenses, not the Renter ledger: edits are
  allowed, and every change is logged with before and after values.
- Tests: dollars to cents (rounding, commas, "$", negative refused),
  GST of 1/11 rounding, GST limits.

## 2c — Photos and documents

- **Photos tab** on the car page: add several photos at once, from the
  camera or the gallery. Each is shrunk on the phone to about 1600px
  (and stripped of hidden location data, as the logo already is), plus a
  small copy for the gallery (rule 21). Tap a photo to see it full size.
  Remove one (kept 30 days, then removed for good, as for logos).
- **Documents tab**: PDFs or images (purchase papers, inspection reports
  and anything else), each with a name typed by the Operator.
- Rego papers, insurance certificates and receipts attach to their own
  records (2a, 2b) using the same upload piece.
- Upload limits: photos 10 MB before shrinking, documents 10 MB; type
  checked from the file's content on the server (rule 22).
- **Change from the phase plan:** a failed photo upload shows "Try
  again" on that photo, rather than a queue that survives losing signal
  or closing the app. The full queue is built with the handover
  checklist in Phase 3 (rule 25), where it matters most, and car photos
  will then use it too. Tradeoff: someone adding car photos with bad
  signal retries by hand until then.

## Database (one migration per part)
- New tables, each with `operator_id`, forced row-level security, the
  Operator-only policy, no deletes, no admin access, and isolation
  tests: `vehicle_registrations`, `insurance_policies`,
  `insurance_policy_vehicles`, `vehicle_purchases`, `vehicle_sales`,
  `vehicle_costs`.
- Every link to a car is the two-column link (car and Operator together),
  so no row can point at another Operator's car.
- Files: new purposes (car photo, car photo small copy, car document,
  rego paper, insurance certificate, receipt), an optional link from a
  file to its car, and a link from a small copy to its photo. The admin
  storage total includes them.
- Activity log entries for every create, change, archive and removal.

## Test checklist
Each part adds its rows to the test checklist sheet as it is built.

## Legal side (added to docs/legal-notes.md when built)
- **A private seller's or buyer's name is personal information** (they
  are not Renters, but the Privacy Act still applies). Collected only
  because purchase records need it; mention in the privacy policy.
- **Record keeping:** purchase and sale papers, rego, insurance and
  receipts are tax records the Operator must keep for 5 years. Archiving a
  cost keeps its receipt; removing a file is the Operator's choice, and
  the terms should say keeping records is the Operator's responsibility.
- **Photos** can show people or other cars' plates. Location data is
  already stripped on the phone.

## Decisions in this plan (pushed back on easily)
1. Insurance has its own list and pages (Cars → Insurance), not only
   inside each car. Tradeoff: one more screen, but a fleet policy is
   entered once, not once per car.
2. GST is a box you can change, pre-filled at 1/11. Tradeoff: an extra
   box, but correct for bills that mix GST and GST-free items.
3. Photo uploads retry by hand until Phase 3 (above).
4. Seller and buyer are a name only (no address or contact details).
   Tradeoff: less to look up later, much less personal information held.
