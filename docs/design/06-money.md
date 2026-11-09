# Money

## Ledger (one per Renter; every line linked to a rental)

- Money follows the Renter who pays: a business Renter's rentals are its
  own, never its drivers' (docs/plans/business-renters.md). A driver who
  also rents on their own owes only on their own rentals.

- Line kinds: charge | payment | credit | refund | reversal.
- Charge categories: weekly_rent, part_week_rent, late_fee,
  fine_passthrough, fine_admin_fee, damage, excess, toll, cleaning, plus
  Operator-defined custom types.
- Each line: amount (cents), GST (cents), description, effective date,
  links (invoice, payment, fine, bond).
- Append-only; corrections are reversals. Balance = sum of lines.
- GST treatment set per charge type by the Operator.

## Bonds (one bond account per rental)

- In: bond payments, upfront or by instalments (e.g. an upfront amount
  then a weekly amount until full).
- Out: deductions (shown on the ledger as "paid from bond") and refunds.
- Held = in minus out, always visible.
- Can be paid by card or bank transfer (BECS limits may block large
  debits on new Stripe accounts).

## Payments

- method type: becs_debit | card | cash | bank_transfer (payto later).
- status: pending | succeeded | failed | refunded.
- Stripe IDs, Stripe fee, payout ID for reconciliation.
- Cash and bank transfers recorded manually with a reference.

## Weekly cycle (scheduled job, Operator timezone)

1. As each rent week starts (rent is charged in exact 24-hour blocks
   from the signed handover, docs/plans/review-fixes-batch-1.md), add
   the rent charge in advance (the nightly rent run).
2. Two hours later the debit run creates a debit for the scheduled
   amount (NOT the whole balance), capped at what is owing less what is
   pending, on the Operator's connected account using the Renter's
   mandate. Only weeks that started in the last 7 days, never the first
   week (docs/plans/phase-4-slice-5.md).
3. Pending up to 3 business days; Stripe's messages set succeeded or
   failed. Only a success puts a payment line on the ledger.

- One-off charges (fines, damage): invoice only, not debited (default,
  decision 2 of slice 5 as changed on 9 Nov 2026) | with the next weekly
  debit | taken now on their own | split over 2 to 12 weekly debits.
- Stripe's own pre-debit notification emails stay on: the business's own
  Stripe settings (Settings → Payments asks it to leave them on).

## Failed payments

- No payment line was ever added (only a success adds one), so nothing
  is reversed: the charge simply stays owing and the Renter is in arrears.
  A refund or a dispute lost later adds a refund line.
- Operator: dashboard alert + immediate email. Renter: SMS + email.
- Auto-retry once after 3 business days; if it fails again, stop and
  flag for the Operator.
- Optional late fee after a grace period (off by default).
- Arrears screen with ageing.

## Documents

- Invoice per weekly charge, emailed automatically. Sequential per
  Operator, no gaps. Tax invoice format when the Operator is
  GST-registered (ABN, GST amount).
- Receipt per payment. Statement on demand for any date range.
- Issued invoices never change; corrections use credit notes.

## Stripe notes

- Connect (Accounts v2) with each Operator on the full Stripe dashboard,
  direct charges on the Operator's account (phase 4 decision 1). The
  mandate is set up on Stripe's page through the Renter's payments link;
  we never see bank details.
- New accounts have default BECS limits per transaction and per week.
- Stripe's DDR agreement has written-notice rules for changing drawing
  arrangement terms: until Stripe confirms, a rate rise for a Renter
  paying by direct debit starts at least 30 days after they sign (slice 5
  decision 3); a fall any week.

## Operator settings (defaults)

- Invoices emailed automatically: yes.
- Failed payment retry: once, after 3 business days.
- Late fee: off.
- One-off charges: added to the next weekly debit.
- Bond instalments: off.
- Custom charge types: allowed.
