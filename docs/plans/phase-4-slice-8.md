# Phase 4 slice 8: profit per car and money on the dashboard

Status: draft for Abhi's approval (5 Nov 2026). Touches money and schema:
nothing is built until approved.

Outline already approved: docs/plans/phase-4.md (slice 8). Design:
docs/design/09-dashboard-and-reports.md (Money section; "all money
figures are calculated from the ledger, never stored"), 02-vehicles.md
and docs/plans/phase-2-step-2.md (costs recorded for this report; "a fleet
premium is split evenly across its cars"). Builds on slices 5 to 7
(migrations 0052 to 0054). Rules 9, 10, 11 and 15 apply throughout.

## What it delivers

- **Income and profit on each car's Costs tab**, for any date range
  (default: the last 12 months): income from the ledger (rent and charges,
  by rental), the running costs for the same days, and the profit.
- **"Profit by car"**, a new list of every car with income, costs and
  profit for a chosen range, sortable by any of them (the "cars list can
  sort by it" in the outline; see decision 3 for why it is its own list).
- **A Money card on the dashboard:** income this month against last
  month, debits pending, debits failed this week, and total owing. Each
  number opens the list behind it.

## Words used here

- **Income:** what the business charged, less credits and corrections,
  for days in the range. Not what was paid: a charge still owing counts.
  Excluding GST on days the business was GST-registered (that GST is the
  tax office's, not theirs).
- **Running costs:** servicing, repairs, other costs, rego, insurance and
  Stripe's fees. **Not** the purchase price or refurb: those are what the
  car cost to buy, shown separately (the Totals card already has them).
- **Profit:** income less running costs.

## How it works

### Income per car (pure function in packages/core)

The ledger is per Renter and every line is tied to a rental, not a car.
A rental can change cars (a car swap), so each line is given to a car
like this, using the possession records (rule 15, `possessions`):

- **Rent and its corrections and credits** (lines with a period): split
  across the cars the rental held during that period, by time held. The
  cents are shared out so the parts add back to the line exactly (largest
  remainder, as `dailyShares` does for rent).
- **A charge linked to a damage record:** the damage record's car.
- **Any other charge or credit:** the car the rental held on the line's
  day; after the return, the last car; before any handover (e.g. a
  cancellation fee), the rental's booked car (`rentals.vehicle_id`).
- **A reversal:** the same car or cars as the line it undoes, in the same
  shares, so a reversed charge nets to exactly zero.
- **Not income:** payments, refunds, "From bond" payments (slice 7; the
  charge they paid is already income), and bond entries.

New function `incomeByCar(lines, possessions, rentals)` in
packages/core/src/vehicle-income.ts, returning cents and GST per car. The
range is on each line's `effective_on` (already the business's calendar
day, rule 10); a rent line crossing the range's edge is counted by its
`effective_on`, as invoices are (decision 2).

### Running costs per car

- **Servicing, repair, other** (`vehicle_costs`, kinds other than refurb):
  counted on their `incurred_on` day.
- **Rego** (`vehicle_registrations`): spread evenly day by day over the
  term it pays for (`paid_on` to `expires_on`); a monthly direct debit's
  amount over its month.
- **Insurance** (`insurance_policies`, `insurance_policy_vehicles`): each
  payment (per `payment_frequency`) spread over the days it covers; a
  fleet policy's share split evenly across the cars on it each day (Phase 2
  step 2's rule).
- **Stripe's fee** on each cleared debit and bond payment
  (`payments.stripe_fee_cents`, from slice 5): to the car the rental held
  when it cleared.
- **GST on costs:** taken off only on days the business was GST-registered
  (it can claim it back then); otherwise the cost counts in full. Stripe's
  fee includes GST, worked out as one-eleventh when registered
  (accountant to confirm).
- Spreading uses the same exact-cents sharing, so a $1,200.00 rego spread
  over 365 days adds back to $1,200.00 over the full year.
- New function `runningCostsByCar(...)` in packages/core, beside the
  existing `carMoneyTotals` (vehicle-costs.ts).

### Profit by car (the list)

- New page "Profit by car" (Cars → Profit, path in lib/paths.ts), on the
  shared list (RecordList: a table on wide screens, cards on phones, rule
  24). Columns: car (rego, make and model), income, running costs, profit,
  days rented in the range. Sort by any; date range picked with two date
  boxes and quick choices (this month, last month, this financial year
  July to June, last 12 months); range and sort kept in the address (nuqs,
  as other lists). Archived and sold cars appear for ranges they were in
  the fleet.
- Worked out on each visit from the ledger and cost records (rule 11,
  design 09): loads the business's lines, possessions and costs for the
  range in one tenant transaction and runs the two core functions.
- Export to a spreadsheet as other lists do (`exportVehicles`'s pattern,
  logged as a list export; no personal data in it).

### The car's Costs tab

- New **Income and profit** card at the top (costs-tab.tsx): range picker
  as above, income, running costs line by line (servicing and repairs,
  rego, insurance, Stripe fees, other), profit, and income by rental
  (Renter's name, dates, amount; each links to the rental).
- The existing Totals card (purchase, refurb, sale, difference) stays.

### Money on the dashboard

New **Money** card (apps/web/src/app/dashboard/dashboard-cards.tsx, loaded
in `loadDashboard`, apps/web/src/lib/dashboard/load-dashboard.ts):

- **Income this month:** month to date, with "Same days last month: $X"
  and "All of last month: $Y". Months in the business's timezone. Opens
  Profit by car for this month.
- **Debits pending:** count and amount (slice 5's `payments` still
  pending). Opens the Owing list (slice 6), which shows pending apart.
- **Debits failed this week:** count and amount in the last 7 days
  (slice 6). Opens the Needs attention group for failed debits.
- **Total owing:** slice 6's "Owing: N Renters, $X" moves into this card.
  Opens the Owing list.
- Shown only when the business has any ledger line; the Stripe lines only
  when it takes Stripe payments.
- A new core function `monthToDateRanges(today)` gives the two ranges;
  income uses the same `incomeByCar` totals (one source of truth).

## Screens

Profit by car page; the Costs tab's Income and profit card; the
dashboard's Money card. All from packages/ui pieces already there
(RecordList, Card, DetailLines, Input for dates, ToggleGroup for quick
ranges, Badge). A loss shows as "−$120.00" with the word "Loss" beside it,
never colour alone (WCAG). No new piece.

## Database changes (migration 0055)

- No new tables and no stored totals (design 09, rule 11).
- New indexes only, for the range reads: `ledger_lines (operator_id,
  effective_on)`, `vehicle_costs (operator_id, incurred_on)`,
  `payments (operator_id, status, settled_at)`.
- Backwards compatible; proved on a filled database (batch 6 rule).
  If slice 6's own indexes already cover the payments read, that one is
  dropped from this migration.

## Build steps

1. **Core:** `incomeByCar`, `runningCostsByCar`, exact-cents sharing over
   time, `monthToDateRanges`, profit. Unit tests to the cent.
2. **Database:** migration 0055.
3. **Server:** loaders for the car, the list, the dashboard and the
   export, each in one tenant transaction.
4. **Screens:** Costs tab card, Profit by car page, dashboard Money card.
5. **Demo data** (a car swap, a fleet policy, a reversed charge, a
   non-registered month), test checklist rows (next free O- IDs), docs,
   deploy.

## Tests

- **Money (core):** a rent week split across a swap adds back exactly; a
  reversal nets to zero on the same cars; credits for unused days lower
  income; "From bond" payments are not income; GST taken off only on
  registered days, for income and costs; rego and insurance spread adds
  back exactly over the term; a fleet premium split evenly, with cars
  joining and leaving the policy part-way; purchase and refurb not in
  running costs.
- **Ranges and timezones:** month boundaries in Perth and Sydney; a range
  ending on a daylight-saving change; financial year July to June; a
  line on the range's first and last day.
- **Edge cases:** a car with no rentals (income 0, costs still count); a
  rental that never started (cancellation fee on the booked car); a sold
  or archived car; no costs at all.
- **Tenant isolation:** business A's list, Costs tab, dashboard and export
  never include B's lines, costs or payments.
- **Scale:** the Profit by car list with demo data of 200 cars and two
  years of rentals stays under a set time in the database tests.
- **Browser (rule 33):** Profit by car at 375px (cards) and wide (table),
  keyboard sorting and range picking; the Costs tab card; the dashboard
  Money card and its links; axe (WCAG 2.2 AA); download budgets for the
  new page and the dashboard.

## Legal notes (to docs/legal-notes.md when built)

- **Not tax advice:** the figures are a management view, not the
  business's accounts or BAS. The page says so in one line (design 09).
- **Accountant:** income counted when charged (not when paid); GST taken
  off only while registered; Stripe's fee GST at one-eleventh; rego and
  insurance spread over what they cover. These are on the accountant list.
- **Privacy:** the export holds no Renter details; the Costs tab's income
  by rental shows Renter names to the business only, as the rental pages
  already do. Admin sees none of it (rule 5).

## Decisions for Abhi (my recommendation first)

1. **Profit counts what was charged, not what was paid.** Tradeoff: a car
   whose Renter never paid still looks profitable (the Owing figure on the
   dashboard shows that money apart); in return the numbers match the
   invoices and an accountant's usual view.
2. **A rent line counts on its own day, not split across a range's
   edge.** Tradeoff: a week charged on 30 June counts wholly in June; in
   return every figure matches an invoice the business can see.
3. **Profit by car is its own list, not a sortable column on the cars
   list.** The cars list is sorted by the database page by page; profit
   is worked out in the app from the ledger each time. Tradeoff: one more
   page; in return the cars list stays fast and the profit list can have
   its own date range.
4. **Payout matching waits for Phase 7 reports.** Slice 5 said the payout
   each debit went out in would come here; nothing on these screens needs
   it, and Stripe's own dashboard shows payouts. Tradeoff: "Next Stripe
   payout" (design 09) is not on the dashboard yet; in return no extra
   Stripe messages to handle before a report uses them.
5. **Fix the Totals card's GST rule at the same time.** The existing
   `carMoneyTotals` always takes GST off the purchase, refurb and sale,
   which is wrong for a business not registered for GST. Flagged, not
   changed without your yes. Tradeoff: one more change in this slice; in
   return both cards on the Costs tab use the same rule.

## Senior review of this plan

- **Money:** integer cents throughout; every share-out adds back exactly;
  reversals follow their line's shares so nothing is left over; GST comes
  from each line's stored GST (rule 9), never recalculated; nothing is
  stored, every figure is added up from the ledger and cost records
  (rule 11, design 09).
- **Found and fixed while writing:**
  - giving every line to `rentals.vehicle_id` would credit a swapped
    rental's whole income to the latest car: possession records are used;
  - counting "From bond" payments, or a bond deduction, as income would
    count the same money twice: only charges and credits count;
  - taking GST off costs for a business that is not registered overstates
    profit: GST comes off only on registered days (and the same flaw in
    the existing Totals card is decision 5);
  - a fleet premium split over "cars on the policy now" would change past
    months when a car leaves: split by the cars on it each day;
  - income "this month vs last month" compared a part month with a whole
    one: both "same days" and "all of last month" are shown.
- **Tenancy:** every loader reads only the session's business (rule 1)
  inside its tenant transaction with forced row-level security (rule 2);
  admin has no access (rule 5).
- **Edge cases:** cars added mid-range, sold mid-range, archived; rentals
  open at the range's end; a line dated before the handover; a business
  that became GST-registered mid-range.
- **Scale:** the list reads a whole range of ledger lines on each visit.
  Fine for v1 fleets, measured in the tests; moved into a database query
  (or a cache rebuilt from the ledger) only if it slows, never into a
  stored figure that could disagree.

## Not in this slice

- Payout matching and "Next Stripe payout" (decision 4: Phase 7).
- This week's rent expected and collected, total bond held, and
  utilisation (design 09; with Phase 7 reports).
- Fines income and costs (Phase 6).
- Reports by week, month or financial year and the GST summary (Phase 7).
