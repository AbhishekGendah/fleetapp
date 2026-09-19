# Money

## Ledger (one per Renter; every line linked to a rental)
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
1. On the charge day, add the rent charge (in advance).
2. Create a debit for the scheduled amount (NOT the whole balance) on
   the Operator's connected account using the Renter's mandate.
3. Pending up to 3 business days; webhooks set succeeded or failed.
- One-off charges (fines, damage): add to next debit (default) |
  separate debit | split over N weeks.
- Stripe's own pre-debit notification emails stay on.

## Failed payments
- Reverse the payment line; the Renter is now in arrears.
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
- Connect Express, direct charges. Mandate is set up during signing;
  we never see bank details.
- New accounts have default BECS limits per transaction and per week.
- Stripe's DDR agreement has written-notice rules for changing drawing
  arrangement terms; confirm before building rate changes (TBD).

## Operator settings (defaults)
- Invoices emailed automatically: yes.
- Failed payment retry: once, after 3 business days.
- Late fee: off.
- One-off charges: added to the next weekly debit.
- Bond instalments: off.
- Custom charge types: allowed.
