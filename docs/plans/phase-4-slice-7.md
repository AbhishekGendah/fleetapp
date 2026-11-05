# Phase 4 slice 7: closing a rental

Status: draft for Abhi's approval (5 Nov 2026). Touches money and schema:
nothing is built until approved.

Outline already approved: docs/plans/phase-4.md (slice 7, legal
questions). Design: docs/design/06-money.md (bonds: "deductions shown on
the ledger as paid from bond, and refunds"), 04-rentals.md ("closed: final
balance settled and bond refunded or deducted"). Builds on slices 5 and 6
(docs/plans/phase-4-slice-5.md and -6.md, migrations 0052 and 0053), which
must be built first. Rules 9, 11, 12, 13, 14, 19 and 20 apply throughout.

## What it delivers

- **Close rental**, on a returned rental's page once the bond hold days
  have passed (the rental's own `bondHoldDaysAfterReturn`, default 28; the
  bond card already shows "Held until"). One page walks through:
  1. **Final rent**: already worked out at the return (`chargeRentNow` in
     apps/web/src/lib/ledger/rent-job.ts adds the last part week, or the
     credit for unused days, under the rental's part-week setting). Closing
     runs it once more and shows the lines, so nothing is missed.
  2. **What is still owing**: every charge not yet paid, oldest first.
  3. **Pay from the bond**: keep part of the bond to pay a charge, with a
     reason the Renter is told. Or add a charge and pay it from the bond in
     one step (e.g. "Cleaning, $150, seats stained").
  4. **Refund the rest of the bond**: by bank transfer or cash (the
     business does it in its own bank and records it here), or back to the
     card or bank account it came from through Stripe.
  5. **The balance**: zero, or a reason to close with money still owing
     (it stays on the Owing list from slice 6). If the Renter is in credit,
     the credit is refunded first.
  6. **Close**: the closing statement is issued (a fixed PDF with its
     fingerprint) and emailed to the Renter; the rental becomes Closed.
- **Refund a bond on a cancelled booking**, by hand or through Stripe,
  from the bond card. Today the card can only say "Bond to refund"; this
  clears the launch-checklist item "a bond refunded by hand can't be
  recorded yet".

## Words used here

- **Paid from bond:** part of the bond used to pay a charge. It shows twice,
  as a pair: a deduction on the bond and a payment on the ledger, method
  "From bond". The pair is only ever made or undone together.
- **Bond refund:** bond money given back to the Renter. It is on the bond
  only, never the ledger (the bond is not the Renter's balance).
- **Closing statement:** the last statement of the rental, covering it
  from the handover to the closing day, with a bond section.
- **Hold days:** how long the bond is kept after the return for late tolls
  and fines.

## How it works

### Paying a charge from the bond

- Form on the closing page (and the bond card from the return onward):
  the charge (one of the rental's owing charges), the amount (money box,
  filled with the smaller of what that charge still owes and what the bond
  holds), and **"Reason (the Renter sees this)"** (required, e.g. "Rear
  bumper repair, damage record of 3 Nov").
- **"Add a charge and pay it from the bond"**: charge type, amount, reason.
  Uses the existing `addCharge` (apps/web/src/lib/ledger/ledger-records.ts)
  so the charge carries its own GST by type (rule 9), then pays it.
- In one transaction with the rental locked (the existing `lockRental` in
  bond-records.ts):
  - a `bond_movements` row, kind `deducted` (exists today; its `note` is
    the reason, already required for a deduction);
  - a `ledger_lines` payment line, method `bond`, amount the same, **GST
    zero**: the GST is already on the charge it pays (legal-notes.md: "GST
    follows the charge it covers"; accountant to confirm, on the list);
  - a `bond_deductions` row pairing the two and naming the charge;
  - one activity entry each (amount and kind only; the reason stays with
    the bond, rule 7 and the existing `logBondMovement` rule).
- Refused if the amount is more than the bond holds now (less refunds
  still on their way), or more than the rental owes in total.
- A receipt is issued for the payment line as for any payment
  (`issuePendingDocumentsQuietly`), titled with method "From bond".
- **Undo a deduction** (bond card or ledger, reason required): reverses
  both halves in one transaction. Reversing only one half is refused on
  the screen and by the database (see Database changes).

### Refunding the bond

- **By hand:** method (bank transfer or cash; `MANUAL_PAYMENT_METHODS`),
  amount (up to what is held), date, reference (capitals, rule 31). A
  `bond_movements` row, kind `refunded`, as the table already allows. The
  Renter's bank details are never asked for or kept (rule 7): the business
  pays from its own bank.
- **Through Stripe:** offered only for bond that came in through Stripe
  (`bond_movements.payment_id`), up to what each Stripe payment brought
  in, less what has already gone back on it (refunds and disputes). A bond
  paid partly by card and partly in cash is refunded in two parts: the
  form shows "Up to $X back through Stripe; the rest by hand".
  1. In one transaction with the rental locked: insert a `refund_requests`
     row (purpose `bond`, the payment, the amount, status `requested`). A
     database rule allows one open request per rental, so a second press or
     second phone gets "A refund of $X is already on its way".
  2. After the transaction (Stripe is never called while rows are locked,
     as in slice 5): ask Stripe to refund that payment on the business's
     own account, idempotency key `refund:{refundRequestId}`.
  3. Save Stripe's refund ID and answer. The bond entry itself is added by
     the existing `applyMoneyTakenBack` (stripe-money-back.ts), from our
     read of the refund straight away or from Stripe's refund event,
     whichever comes first: its unique rule on the Stripe object and kind
     means the second adds nothing (rule 20).
  4. A refund Stripe later fails is already handled (`undoFailedRefund`
     puts the money back on the bond). The request is marked failed and
     the dashboard's "Bonds to refund" shows the rental again.
  - A request stuck without Stripe's answer is recovered as slice 5 does:
    same key within 23 hours, then looked up by our ID in Stripe's notes.
- Money still on its way back counts as already gone when working out
  what can be refunded or deducted, so nothing is given back twice.

### A credit at the end

- If the Renter paid more than they owe (e.g. the unused-days credit after
  an early return), the closing page shows "Owed back to the Renter: $X"
  and offers the same two ways: by hand (a ledger `refund` line, method
  bank transfer or cash, reference) or back through Stripe on one of the
  Renter's cleared debits (a `refund_requests` row, purpose `credit`;
  slice 5's refund handling adds the ledger refund line through
  `payment_ledger_lines`).

### Closing

- **Offered when** the rental is returned and today (business's calendar)
  is on or after `bondHeldUntil`. Before that, the button reads "Close
  before the hold ends" and asks "Are you sure? Late tolls and fines may
  still arrive" (decision 1).
- **Refused while** a debit or bond debit is still clearing, a refund
  request is open, the bond still holds money, the Renter is owed a
  credit (decision 3), or the rent run still has something to add.
- **Money still owing:** "Close with $X still owing" needs a reason (kept
  on the rental, shown to the business only). The rental stays on the
  Owing list (slice 6 lists Renters owing whatever the rental's status).
- **In one transaction, rental locked:** run `chargeRentNow` and stop if
  it added anything (the page reloads to show it); check the above again;
  issue the closing statement (rendered, stored, fingerprinted, recorded,
  as slice 2's documents are, through the existing `issueDocument`); set
  status `closed`, `closed_at`, `closed_by_user_id`, the reason if owing,
  and `closing_statement_id`; log it (rule 19). The status move
  returned → closed is already allowed by `app.check_rental_status_move`.
- **After the transaction:** email the closing statement to the Renter
  (the existing `emailBillingDocument`; "Email again" if it fails);
  expire any open Stripe page and revoke any live payments link for the
  rental; if the Renter has no other open rental, cancel their direct
  debit at Stripe with the existing `detachPaymentMethod` (decision 2).
- **Closing twice** (two presses, two phones): the second finds the
  rental closed and shows the closing statement.

### The closing statement

- From the handover day to the closing day: every ledger line with the
  balance after it (the existing `statementFigures`), the final rent and
  any credit for unused days, then **Your bond**: received, each amount
  kept with the charge it paid and its reason, each refund (how and when),
  and "Bond held now: $0.00". It ends with the balance: "Nothing owing",
  or "Still owing: $X" with the business's "How to pay" text.
- A new kind `closing_statement`, one per rental. Fixed once issued (rule
  12). Anything that happens later (a late payment, a dispute, a refund
  failing) appears on an ordinary statement, never by changing this one.
- Email wording: "Your rental of [car] has been closed. We kept $X from
  your bond for: [reasons]. $Y was refunded by bank transfer on [date].
  If you disagree with anything kept, contact [business, phone, email]."
  Transactional (Spam Act), names the business.

### After closing

- **Allowed:** payments by hand and their corrections (so money owed can
  still be paid; today `OPEN_FOR_MONEY` refuses a closed rental, which
  would trap that money), bond refunds by hand, and anything Stripe tells
  us (a dispute, a failed refund: Stripe's truth is always recorded).
- **Not allowed:** new charges or credits from the screen. A late toll or
  fine after closing waits for Phase 6, which decides how it reaches a
  closed rental.
- The rent run stops looking at closed rentals (`rentalsToCharge` today
  includes `closed` within its 60-day lookback); closing has already made
  sure nothing is due.
- `loadBondsToRefund` (apps/web/src/lib/dashboard/bonds-to-refund.ts)
  also lists closed rentals that hold bond again (a refund that failed).

## Screens

- **Close rental page** (`/rentals/[rentalId]/close`, path in
  lib/paths.ts): the six steps above as cards, one column at 375px, each
  card's total in plain words. Final button "Close rental and email the
  statement" (ConfirmButton).
- **Bond card** (bond-card.tsx): "Pay a charge from the bond", "Refund
  bond" (by hand or through Stripe), "Undo" on a deduction, "Refund on its
  way" status; on a cancelled booking, "Refund bond" replaces today's
  "refund it in your Stripe dashboard" text.
- **Money card and ledger:** method "From bond" on paired lines; "Closed
  with $X owing: [reason]" on a closed rental; the closing statement in
  the documents list.
- **Rentals list:** a Closed filter (the status exists; the filter may
  already show it).
- All from packages/ui pieces already there (FormDialog, MoneyInput,
  Input, Select, ToggleGroup, ConfirmButton, RecordList, Badge, Card,
  RequiredFieldsNote). No new piece. Every reason field is required with
  the red asterisk (rule 28); amounts use the money box, references are
  capitals (rule 31); fields checked as typed with the server's Zod schema.

## Database changes (migration 0054, after slice 6's 0053)

Backwards compatible with the code before it, proved on a filled
database (batch 6 rule).

- **`payment_method` enum:** add `bond`. Rules in the same migration
  compare as text (a new enum value can't be used in the transaction that
  adds it, as 0041 and 0052). `bond_movements` and `payments` refuse
  `bond`; on `ledger_lines` it is allowed only on a `payment` line.
- **`bond_deductions`** (new tenant table): the deduction (`bond_movements`
  row of kind `deducted`), the ledger payment line, the charge line it
  pays; each unique (one pair per entry). Three-column links including
  `operator_id` and `rental_id`, so all three belong to the same rental of
  the same business. A check at commit (deferred constraint trigger)
  refuses: a `bond` payment line with no pair, a pair whose two amounts
  differ, or a reversal of one half without the other in the same
  transaction. Append-only.
- **`refund_requests`** (new tenant table): rental, purpose (`bond`,
  `credit`), the Stripe payment refunded, amount (cents, more than 0),
  status (`requested`, `sent`, `failed`; forward only), Stripe's refund ID
  (unique, set once), failure code, who asked, when. One open request per
  rental (partial unique index).
- **`rentals`:** `closed_at`, `closed_by_user_id`, `closed_owing_reason`,
  `closing_statement_id` (link to `issued_documents` of the same rental and
  business). A check: closed exactly when `closed_at` and
  `closing_statement_id` are set. Set once, never changed.
- **`issued_document_kind` enum:** add `closing_statement`; unique one per
  rental.
- Every new table: `operator_id NOT NULL`, row-level security on and
  forced, web app login only; the admin app gets nothing (rule 5).
- Nothing changes or removes an existing money row (rule 11).

## Stripe pieces (behind the payments interface)

- `PaymentsProvider` gains `createRefund(accountId, { paymentIntentId,
  amountCents, idempotencyKey, reference })` returning a `MoneyTakenBack`,
  and `findRefundByReference` for recovery. Real one in
  stripe-provider.ts, stand-in in stand-in-provider.ts (decision 6 of the
  phase), which already makes refund events in Stripe's shape.
- No new event types: `v1.refund.created`, `.updated` and `.failed` are
  already on the launch checklist's list.

## Build steps

1. **Core (packages/core):** close readiness (hold day passed, nothing
   clearing, bond held 0, balance and reason), what can be refunded per
   Stripe payment, deduction limits, closing statement figures with the
   bond section. Unit tests to the cent.
2. **Database:** migration 0054 and database tests.
3. **Server:** pay from bond and undo, bond refunds (by hand and Stripe),
   credit refunds, close, closing statement, emails, after-close rules,
   rent run change, bonds-to-refund change.
4. **Screens:** close page, bond and money cards, cancelled-booking
   refund.
5. **Demo data, test checklist rows (next free O- IDs), docs, deploy;**
   then one refund of a card bond and one of a BECS bond in Stripe's
   sandbox.

## Tests

- **Money:** a deduction pays exactly its amount and the balance moves by
  it; GST unchanged by a deduction; undo reverses both halves exactly;
  balances equal the sum of lines and bond held equals the sum of entries,
  before and after closing.
- **Database:** a `bond` payment line without its pair, a pair with
  different amounts, and reversing one half alone are each refused at
  commit; `bond` refused on bond movements and payments.
- **Double money back:** two presses or two phones make one Stripe refund;
  a refund on its way counts as gone; refund above what a Stripe payment
  brought in refused on the server; a Stripe event and our own read both
  arriving add one bond entry; a failed refund puts the money back and the
  rental on "Bonds to refund".
- **Closing:** refused before the hold day without confirmation, with bond
  held, a debit clearing, an open refund, a credit owed, or rent still to
  add; with money owing only with a reason; closing twice issues one
  statement; the statement's figures match the ledger and bond exactly.
- **After closing:** a payment by hand accepted; a charge refused; a
  Stripe dispute still recorded; the rent run adds nothing.
- **Timezones:** hold day worked out in Perth and Sydney, and across a
  daylight-saving change.
- **Tenant isolation:** business A can't deduct from, refund, close or
  read B's rental, pairs or refund requests; a refund event on A's account
  can never touch B's bond.
- **Browser (rule 33):** the close page at 375px and wide, keyboard only,
  through to closed (stand-in Stripe); refund of a cancelled booking's
  bond; axe (WCAG 2.2 AA); download budget for the new page, the rental
  page's unchanged.

## Legal notes (to docs/legal-notes.md when built)

- **Bond deductions (lawyer, Australian Consumer Law):** keeping bond must
  rest on the signed contract, for actual loss, and the Renter must be told
  what was kept and why, with a fair chance to dispute. Built in: a reason
  on every deduction, shown on the closing statement and in its email with
  the business's contact; a deduction can be undone. Lawyer to say whether
  notice must come before keeping the money (decision 4).
- **GST (accountant):** a deduction carries no GST of its own; the charge
  it pays already does. Already on the accountant list.
- **A bond nobody can return to (lawyer):** a Renter who can't be reached;
  state unclaimed-money rules may apply. The bond stays on "Bonds to
  refund" until then.
- **Stripe refunds:** come from the business's Stripe balance; Stripe
  generally keeps its original fee on a refund (to confirm in the
  sandbox). BECS refund time limits and timing to confirm there too
  (Stripe's docs could not be reached from this session).
- **Direct debit:** cancelling the authority once no rental is open
  (decision 2) matches the Direct Debit Request's purpose.
- **Record keeping:** closing statements, deductions and refunds are tax
  and consumer records, kept at least 5 years; the retention job already
  waits while a bond is held or money is owed either way.

## Decisions for Abhi (my recommendation first)

1. **Closing before the hold ends is allowed, with an "Are you sure?".**
   Tradeoff: a late toll may then have nowhere to go until Phase 6; in
   return a business that knows nothing more is coming isn't made to wait
   28 days to refund a Renter.
2. **On closing, the Renter's direct debit is cancelled at Stripe when they
   have no other open rental.** Tradeoff: a returning Renter sets it up
   again; in return no authority to take money sits unused.
3. **A credit owed to the Renter must be refunded before closing** (no
   "close anyway"). Tradeoff: an unreachable Renter's rental stays open;
   in return the business never closes holding the Renter's money.
4. **The Renter is told by the closing statement and its email**, not a
   separate notice with a waiting period first. Tradeoff: they can only
   dispute after the money was kept (the business can undo it); in return
   closing is one sitting. If the lawyer wants notice first, a setting
   "tell the Renter N days before keeping bond" is added.
5. **Bond refunds go back through Stripe only to the payment it came
   from**, never to a different card or account. Tradeoff: a Renter whose
   card has expired is refunded by bank transfer instead; in return money
   only goes back where it came from (Stripe handles expired cards itself).

## Senior review of this plan

- **Money:** integer cents throughout; GST stays on charges and is never
  doubled or lost by a deduction; every change is an added line or entry
  (rule 11); undo is a pair of reversals. Bond and ledger stay separate
  accounts joined only by the pair table.
- **Found and fixed while writing:**
  - a closed rental with money owing could not take a payment
    (`OPEN_FOR_MONEY` excludes closed), so payments by hand stay open after
    closing, charges do not;
  - the rent run still looks at closed rentals for 60 days and could add a
    correction after the closing statement: closing runs it first and
    refuses if anything is due, and the run then skips closed rentals;
  - the existing ledger "Correct" and bond "Correct" buttons would undo one
    half of a pair: refused on screen and at commit by the database;
  - a Stripe refund still on its way would leave the bond looking full, so
    a second refund could be asked for: open requests count as gone, one
    per rental, idempotency key from the request;
  - a refund failing or a BECS dispute after closing: always recorded, and
    the rental shows again on "Bonds to refund" or Owing;
  - `bond_deductions` could point at another rental's charge: three-column
    links make that impossible.
- **Immutable documents:** the closing statement is issued once with its
  SHA-256 fingerprint; later events go on ordinary statements.
- **Tenancy:** everything runs in the session's business (rule 1); Stripe
  refund events matched by account (rule 3); forced row-level security;
  admin has none (rule 5).
- **Edge cases:** no bond at all (steps 3 and 4 skipped); bond more than
  owing (refund the rest); owing more than bond (keep it all, close with a
  reason or wait); bond paid by card and cash (two refunds); a car swap
  during the rental (one rental, one bond); early return credit (step 5).
- **Not checked yet:** a deduction for a damage charge is counted
  oldest-first like every payment (`owingCharges`), so on the Owing ages
  it may show as paying older rent; totals are right, the reason text
  names what it was for. Acceptable; flagged.
- **Logging:** reasons, references and names never in logs (rule 7).

## Not in this slice

- Fines and tolls arriving after closing (Phase 6).
- Moving a credit from one rental to another of the same Renter.
- Bond instalments (design 06 setting "off"; later).
- Profit per car and money on the dashboard (slice 8).
