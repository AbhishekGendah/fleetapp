# Phase 2 step 2 plan — car paperwork, costs and photos

Status: waiting for Abhi's approval (decisions 2 and 3 agreed, 4 changed at his request). Detail for step 2 of
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

- Most Operators insure each car on its own policy, so the easy path is
  on the car's page: "Add insurance" creates a policy for that car.
  From there: see its current policy, put it on an existing (fleet)
  policy, or take it off.
- Cars → Insurance lists every policy, for fleet policies (one policy,
  several cars ticked) and to see what renews when.
- A fleet premium is split evenly across its cars for the profit report
  (Phase 4). Per-car premiums can be added later if insurers itemise them.
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
  bought from a dealer or a private seller, seller's name, phone and
  address, odometer at purchase, and attachments (contract, transfer
  papers). The odometer is saved as a reading dated the purchase day
  (source "purchase"). A private-seller purchase has no GST: the GST box
  is locked at $0.
- **Sale** (`vehicle_sales`, one per car): date and time of handover
  (stored in UTC, entered in the Operator's timezone: a fine on the sale
  day may fall either side of it), price, GST, buyer's name, phone,
  address and licence number (optional), the date and reference the
  transfer was lodged with the transport department, and attachments
  (signed transfer form, receipt). Saving it sets the car to Sold and
  offers to archive it. A reminder on the screen says to lodge the
  transfer, because until it is lodged fines can still reach the seller.
- **For fines (Phase 6):** a fine dated after a car's sale shows "Sold to
  ... on ..." with the paperwork, ready to nominate the buyer.
- **Transfer papers are identity documents:** they usually carry the
  other person's licence number and date of birth, so purchase and sale
  attachments go in the identity storage, open only through links that
  expire in minutes, and every view is logged (rule 8).
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
- **Sellers' and buyers' details are personal information** (they are not
  Renters, but the Privacy Act still applies): name, phone, address,
  licence number and transfer papers. Collected to prove when ownership
  changed and to deal with fines after a sale; say so in the privacy
  policy. Licence numbers are never logged (rule 7).
- **Transfer of ownership** rules differ by state (who lodges, by when,
  stamp duty). Check each state when fines are built; the sale screen
  reminds the Operator to lodge the transfer.
- **Record keeping:** purchase and sale papers, rego, insurance and
  receipts are tax records the Operator must keep for 5 years. Archiving a
  cost keeps its receipt; removing a file is the Operator's choice, and
  the terms should say keeping records is the Operator's responsibility.
- **Photos** can show people or other cars' plates. Location data is
  already stripped on the phone.

## Decisions in this plan (pushed back on easily)
1. Insurance is added from the car's page; Cars → Insurance also lists
   all policies, for fleet policies (Abhi asked how fleets work: answered).
2. GST is a box you can change, pre-filled at 1/11. Tradeoff: an extra
   box, but correct for bills that mix GST and GST-free items.
3. Photo uploads retry by hand until Phase 3 (above).
4. Seller and buyer keep name, phone, address (and the buyer's licence
   number), plus transfer papers (Abhi's call, for fines after a sale).
