# Phase 4: Money

Status: approved by Abhi on 3 Nov 2026, with decision 1 (full Stripe
dashboard). Slice 1 built 3 Nov 2026. Touches money, schema and
Stripe, so nothing is built until it is approved. Design: docs/design/06
(money), 01 (Stripe on the Operator), 04 and 05 (where rentals and signing
hand over to money). Rules 9, 11, 12, 16, 17, 19 and 20 apply throughout.

## What Phase 4 delivers

Every rental's money, from the first charge to the closing balance:

- A **ledger** per Renter: every charge, payment, credit and correction as
  a line that is only ever added, never changed (rule 11). The balance is
  always added up from the lines.
- **Weekly rent charged automatically** on the rental's charge day, in
  advance, at the rate in force, with part weeks worked out by the rental's
  own setting.
- **One-off charges** the Operator adds (damage, excess, cleaning, tolls,
  late fees, their own types), each with its GST treatment.
- **Invoices, receipts and statements** as fixed PDFs with a fingerprint
  (rule 12); invoice numbers in sequence per Operator with no gaps (rule
  17); a tax invoice when the Operator is GST-registered.
- **Stripe**: the Operator connects their own Stripe account; the Renter
  sets up a BECS direct debit (and can pay the bond by card) as the last
  steps of signing; the weekly debit is taken from their bank on the charge
  day; Stripe tells us the result.
- **Failed payments and arrears**: one automatic retry, then the Operator
  is told; an arrears list showing how long each balance has been owed.
- **Closing a rental**: final charges, deductions from the bond (each with
  a reason the Renter is told), the bond refund, and the closing statement.
- **Profit per car**: income from the ledger against the costs already
  recorded in Phase 2.

Not in Phase 4: AGS's own subscription billing (Phase 8), fines (Phase 6),
SMS (provider not chosen; email until then), PayTo (later; the payment
method is a type field, rule 16).

## Slices

Each slice is usable and tested on its own and deployed before the next.
Slices 1 and 2 need no Stripe at all: payments are recorded by hand (cash,
bank transfer), which is also what many Operators will keep doing.

### Slice 1: the ledger and weekly charges

- **Charge types** (Settings → Charges): the built-in ones (weekly rent,
  part-week rent, late fee, damage, excess, cleaning, toll; fine pass-through
  and fine admin fee come with Phase 6) plus the Operator's own. Each has a
  GST treatment: taxable (GST is one-eleventh of the amount), GST-free, or
  outside the GST system. Defaults: rent and fees taxable when the Operator
  is GST-registered; tolls and fine pass-throughs passed on as charged.
  Changing a type's treatment affects new lines only. GST is worked out
  only when the Operator is GST-registered on the line's date (Phase 1's
  registration date); otherwise it is zero.
- **Ledger lines** (one ledger per Renter, every line tied to a rental):
  kind (charge, payment, credit, refund, reversal), charge type, amount in
  cents, GST in cents stored on the line (rule 9), description, the date it
  counts from, the period it covers (rent only), links (invoice, payment,
  bond movement, damage record). Corrections are a reversal line pointing
  at the line it undoes (rule 11). The database refuses any update or
  delete, as for bond movements.
- **Weekly rent, in advance, from the handover:** rent starts when the car
  is handed over (the Renter's acceptance, rule 15), not the planned start,
  so a late pickup is not charged for days without the car. A scheduled job
  runs once a day after midnight in every Australian timezone (16:00 UTC is
  midnight in Perth and later than midnight everywhere east). It works one
  Operator at a time, in that Operator's tenant context (rule 3). For each
  rental that is out (and an overdue one: rent keeps running until the car
  is back), it adds the charge for every period that has started and is not
  yet charged, so a day the job did not run is caught up the next day. The
  rent for a period follows the rate history day by day, so a rate change
  part-way through a week is charged exactly. A unique rule on (rental,
  period start) means running the job twice never charges twice (rule 20).
- **Part weeks:** the first period (when the start day differs from the
  charge day) and the last after an early return follow the rental's
  snapshotted setting (`partWeekCharging`). An early return credits the
  unused days of a week already charged, as a credit line carrying its own
  share of the GST back.
- **One-off charges** from the rental page: type, amount (money box),
  description, date; the damage record page offers "Charge the Renter" with
  the repair or excess amount filled in.
- **Payments by hand:** cash or bank transfer, with a reference, recorded
  against the Renter's ledger.
- **What is owing:** payments pay off the oldest charges first, so each
  charge is either paid or owing, and owing has an age (from the charge's
  date). A debit still pending is shown apart and not counted as overdue.
- **Who can see it:** the ledger and everything below are tenant tables
  with forced row-level security (rules 1 and 2), and the admin app has no
  access to them at all (rule 5).
- **Screens:** a Money card on the rental (balance, last charges, add a
  charge, record a payment); a Ledger tab on the Renter (every line, running
  balance, phone cards); the dashboard's "Owing" count.
- **Rounding:** all sums in whole cents. Daily pro-rata splits a week's
  rate into seven days with the cents spread so the seven add back to the
  weekly rate exactly. GST on a taxable line is the amount ÷ 11, rounded to
  the nearest cent (half up), stored once and never recalculated.

- **As built (3 Nov 2026):** the dashboard's "Owing" count moved to slice 6,
  with the arrears list it belongs to. The built-in charge types are added
  in each business's own tenant context the first time they are needed
  (a database trigger could not do it under forced row-level security).

### Slice 2: invoices, receipts and statements

- **Invoice per weekly charge**, plus one per one-off charge (or grouped
  with the next weekly invoice: the Operator's setting, default grouped).
  Emailed to the Renter automatically (setting, default on).
- **Numbers in sequence per Operator with no gaps (rule 17):** a counter
  per Operator, taken and moved on inside the same database transaction
  that records the invoice, so a failure takes neither. Format set by the
  Operator (prefix and starting number, e.g. INV-1001).
- **Tax invoice** when the Operator is GST-registered on the invoice date,
  with everything the ATO asks for: the words "Tax invoice"; the
  business's name and ABN; the date; each item with its price and GST, with
  GST-free items marked; the GST total; and the Renter's name (the ATO asks
  for the buyer's identity from $1,000). Otherwise an "Invoice", with no GST
  shown.
- **Fixed once issued (rule 12):** PDF stored with its SHA-256 fingerprint.
  A mistake is fixed with a **credit note** (its own number from the same
  sequence) and, if needed, a new invoice. Never an edit.
- **Receipt** per payment (PDF, emailed). **Statement** for any date range
  on demand (PDF), and a closing statement at the end of a rental.

### Slice 3: the Operator connects Stripe

- Connect each Operator's own Stripe account (decision 1). The Operator's
  business is the merchant: their name is on the Renter's bank statement,
  they pay Stripe's fees, they handle refunds and disputes. AGS takes no
  cut in Phase 4.
- Onboarding is Stripe's own: a button in Settings → Payments opens it; we
  store only the account's ID and its status (charges enabled, payouts
  enabled, BECS ready). The setup checklist gains the step, with the
  reminder to ask Stripe for higher BECS limits.
- **Webhooks:** one endpoint; every event's signature checked; every event
  ID recorded and a repeat ignored (rule 20). Each event's Operator is
  found from its connected account ID, never from what the event claims
  (rule 3): a narrow database function that only maps a Stripe account ID
  to its Operator (like the other cross-Operator lookups on the security
  review list), then the event is handled inside that Operator's tenant
  context.
- **Payments blocked until Stripe says charges are enabled.** Until then
  slices 1 and 2 work as before.
- Stripe sits behind a payments interface, like storage and email: the real
  one talks to Stripe, an in-memory one stands in for every test. The Stripe
  secret key and webhook secret are env vars (Zod, .env.example, turbo.json),
  never in the browser.

### Slice 4: the Renter's direct debit and bond payment

- Two new last steps on the Renter's signing link, after they sign:
  **Set up your direct debit** (BECS: Stripe's own form, on the Operator's
  account, with Stripe's Direct Debit Request and service agreement shown
  and accepted there) and, if the bond is not yet paid, **Pay your bond**
  (card, or BECS where the Operator's limit allows).
- We never see or store bank or card details (rule 7): Stripe's form runs
  in its own frame; we keep only Stripe's IDs and the method type
  (`becs_debit`, `card`; rule 16). Stripe's form script loads from
  Stripe's own site, so the page's security settings allow it there only,
  and the signing page's download budget is measured with it.
- A bond paid by card or debit is recorded on the bond account
  automatically once Stripe says it succeeded, linked to the payment.
- The rental page shows the mandate's state (set up, waiting, cancelled by
  the bank). Handover can require it (setting, default on, override with a
  reason as for the bond).
- A Renter can be sent a fresh "set up your direct debit" link on its own
  (to change bank account), single-purpose and expiring like every link
  (rule 26).

### Slice 5: weekly debits

- On the charge day, after the rent is charged, the job asks Stripe to
  debit **the scheduled amount, not the whole balance** (design 06): the
  week's rent plus any one-off charges set to "add to the next debit".
  One-off charges can instead be debited on their own, or split over N
  weeks (the Operator chooses per charge; default: next debit).
- Each debit is a payment record: method type, amount, status (pending,
  succeeded, failed, refunded), Stripe's IDs, Stripe's fee, the payout it
  went out in. One debit per rental per period (unique rule; rule 20), and
  Stripe's own idempotency key from the same values, so a re-run never
  debits twice.
- **When the money counts (decision 2):** the payment line goes on the
  ledger when Stripe says the debit succeeded (BECS takes a few business
  days), not when it is asked for. Until then the rental shows "Debit of
  $X pending since …". A debit that later comes back disputed (Renters can
  dispute a BECS debit with their bank for up to 7 years, and the bank's
  decision is final) adds a reversal line.
- Stripe's own pre-debit emails stay on (design 06).
- A debit over the Operator's BECS limit is refused by Stripe: it is a
  failed debit with that reason shown, and the setup checklist's reminder
  to raise the limit is shown again.

### Slice 6: failed payments and arrears

- A failed debit: the Operator is told at once (dashboard alert and email),
  the Renter by email (SMS later), with the amount and what happens next.
- **One automatic retry** after 3 business days (setting), counting
  weekends and the national and the Operator's state public holidays (a
  maintained holiday list library, chosen and pinned with its reason in the
  slice's commit, rule 32). If the retry fails, no more tries: the rental is
  flagged for the Operator.
- **Late fee** after a grace period: off by default; when on, added once
  per missed payment as its own charge (its GST per its type), and only if
  the contract allows it (a merge field for the template; consumer law).
- **Debit what's owing now:** a button on the rental for the Operator to
  debit the amount owing (or part of it) at once from the Renter's direct
  debit, logged, one at a time. Weekly debits otherwise take only the
  scheduled amount (design 06).
- **Arrears list:** every Renter owing, with how long (current, 1 to 7, 8
  to 14, 15 to 30, over 30 days), the last payment and a link to the
  rental.

### Slice 7: closing a rental

- After the return and the bond hold days (setting, already snapshotted),
  the rental page offers **Close rental**: final rent and part-week credit
  (slice 1), outstanding charges, and the bond:
  - **Deduct from bond**: amount, charge it covers, reason. Shown on the
    ledger as "paid from bond" and on the bond account as a deduction. The
    Renter is told what was kept and why (consumer law).
  - **Refund the rest**: by bank transfer (recorded) or back to the card
    or account it came from through Stripe.
- Closing needs a zero balance (or an Operator's reason to close with one
  owing, which stays on the arrears list). The closing statement is issued
  and emailed. The rental becomes closed (the status already exists).

### Slice 8: profit per car and money on the dashboard

- Each car's Costs tab gains income (rent and charges from the ledger, by
  rental) and profit for any date range; the cars list can sort by it.
- Dashboard: income this month against last month, payments pending,
  failed this week, total owing.

## Decisions (pushed back on easily)

1. **Stripe: Accounts v2 with direct charges, each Operator on the full
   Stripe dashboard, not Express.** CLAUDE.md says "Connect Express,
   direct charges"; Stripe's current guidance is that direct charges suit
   connected accounts with full dashboard access, and are not recommended
   on its older Express accounts. With the Express dashboard and direct
   charges, the platform (AGS) is always responsible for an Operator's
   negative balance, and BECS disputes can arrive for up to 7 years with no
   appeal. With the full dashboard, the Operator's business carries its own
   refunds, disputes and negative balance, as the merchant it is.
   Tradeoff: Operators see Stripe's full dashboard (more to learn) and AGS
   has less say over their account settings. Approved 3 Nov 2026;
   CLAUDE.md updated to match.
2. **A payment counts when Stripe says it succeeded**, not when it is
   asked for. Tradeoff: for a few days the balance shows the week owing
   while the debit is pending (the rental says so); in return the ledger
   never carries a payment that then has to be taken back for an ordinary
   failure.
3. **A new weekly rate starts at least 30 days after the Renter signs it**
   when they pay by direct debit, unless Stripe confirms a shorter notice
   is enough for a change the Renter has agreed and signed. Stripe's
   current Australian Direct Debit service agreement says at least 30
   days' written notice of changes to the drawing arrangements; older
   copies say 14. The signed change of terms is the written notice. The
   change-of-rate form offers dates from 30 days ahead, and its wording
   says "from [date], or 30 days after you sign if later", so a late
   signature moves the start rather than breaking the rule. Charges and
   debits then always agree. Tradeoff: a rate rise takes effect later; in
   return nothing breaks Stripe's terms and no one looks behind on
   payments. Abhi asks Stripe (one email) and we shorten it if they agree.
4. **Rent in advance, the rate followed day by day.** Tradeoff: a week
   where the rate changes has an invoice line that is not a round number;
   in return a change applies from exactly the day agreed.
5. **Slices 1 and 2 before Stripe.** Tradeoff: automatic debits come
   third; in return the ledger, invoices and GST are proven first and work
   for Operators who take cash and transfers.
6. **Testing without Stripe:** every test uses an in-memory stand-in for
   Stripe behind the payments interface, including webhook events built in
   Stripe's shape. Before slice 5 goes live, a manual check in Stripe's test
   mode (a sandbox account) runs the whole cycle once, with Stripe's test
   bank accounts that succeed and fail. Tradeoff: CI never talks to Stripe;
   in return tests are fast and leave nothing behind.

## Tests required (CLAUDE.md)

- Money and GST: every rounding case (pro-rata days, ÷ 11, a rate change
  mid-week, a credit for unused days), with sums checked to the cent.
- The ledger: lines can never be changed or deleted (database refuses);
  reversals undo exactly; balances always equal the sum of lines.
- Invoice numbers: no gaps and no repeats under concurrent issuing; a
  failed issue uses no number.
- Idempotency: the daily job and the debit run twice charge and debit once;
  a webhook event delivered twice is handled once.
- Timezones: charge days and the daily job around midnight in Perth and
  Sydney and across a daylight-saving change.
- Tenant isolation: Operator A can never see or touch Operator B's ledger,
  invoices, payments or Stripe events, including through a webhook naming
  another Operator's account.
- Browser: every new screen at phone width with keyboard use, axe and a
  download budget (rule 33).

## Legal and money questions (to docs/legal-notes.md as each slice lands)

- **Accountant:** GST on a bond deduction (follows the charge it covers),
  on late fees, on damage recovery and on excess passed on; credit for
  unused days on an early return; whether a weekly in-advance invoice is
  the right tax point.
- **Lawyer:** late fees and bond deductions must rest on the contract
  (unfair terms, Australian Consumer Law); the Renter told what each
  deduction is for, with a fair chance to dispute.
- **Stripe:** confirm the notice for a changed debit amount (decision 3);
  check the default BECS limits for a new account, and how an Operator asks
  for more.
- **Privacy:** payment details go to Stripe (in Australia and overseas):
  the privacy policy and the signing pages say so (APP 8, cross-border
  disclosure). We store only Stripe's IDs.
- **Record keeping:** invoices, receipts and the ledger are tax records:
  kept at least 5 years (ATO). Never deleted by the retention jobs.

## What Abhi will need to do (one step at a time, when we get there)

- Slice 3: make a Stripe account for AGS in test mode (sandbox), turn on
  Connect, and put the test keys in Vercel and GitHub secrets (never in
  chat). I will give one step at a time.
- Before going live: the same in live mode, and the Stripe question in
  decision 3.

Sources checked:
[Stripe: recommended Connect integrations and charge types](https://docs.stripe.com/connect/integration-recommendations),
[Stripe: configure connected accounts (Accounts v2)](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration),
[Stripe: charges on Connect](https://docs.stripe.com/connect/charges),
[Stripe: Australia BECS Direct Debit](https://docs.stripe.com/payments/au-becs-debit),
[Stripe: BECS Direct Debit Request Service Agreement](https://stripe.com/au/legal/becs-dd-service-agreement),
[Stripe: bank debit authorisations](https://stripe.com/legal/bank-debit-authorizations),
[Stripe: payouts](https://docs.stripe.com/payouts),
[ATO: tax invoices](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices).
