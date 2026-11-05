# Phase 4 slice 5: weekly debits

Status: draft for Abhi's approval (5 Nov 2026). Touches money, schema and
Stripe: nothing is built until approved.

Outline already approved: docs/plans/phase-4.md (slice 5, decisions 2, 3
and 6). Design: docs/design/06-money.md (weekly cycle), 01 (Stripe on the
business's own account), 04 (rentals). Builds on review fixes batch 1 (rent
in 24-hour blocks) and batch 2 (bond and direct debit), both built. Rules
3, 9, 11, 14, 16, 19 and 20 apply throughout.

## What it delivers

- **The weekly debit.** For a long-term rental whose Renter has a working
  direct debit, the app asks Stripe to take that week's rent from the
  Renter's bank once the week has been charged, plus any one-off charges
  set to "add to the next debit". Only the **scheduled amount**, never the
  whole balance (design 06), and never more than is actually owing.
- **One-off charges, collected how the business chooses:** with the next
  weekly debit (default), debited on their own straight away, or split over
  2 to 12 weekly debits.
- **The money counts only when Stripe says it arrived (decision 2).** Until
  then the rental shows "Debit of $X pending since Tue 10 Nov". When it
  clears, a payment line goes on the ledger and the Renter's receipt is
  issued as for any payment. A debit the Renter later disputes with their
  bank adds a reversal line; a dispute the business wins adds the payment
  back.
- **A debit never happens twice** for the same week, even if the run is
  repeated, crashes half way or Stripe's messages arrive twice.
- **Over the business's BECS limit:** Stripe refuses it; the debit shows as
  failed with "Over your Stripe direct-debit limit", and the setup
  checklist's "ask Stripe to raise your limits" step is shown again.
  (What happens after any failure is slice 6.)
- **Rate changes for direct-debit Renters start at least 30 days after the
  Renter signs (decision 3)**, so a debit never takes a new amount without
  the notice Stripe's Direct Debit Request promises.

Stripe's own advance-notice emails to the Renter stay on (design 06).

## Words used here

- **Direct debit** (Stripe calls it a mandate): the Renter's permission,
  given on Stripe's page in slice 4, for the business to take money from
  their bank. Already stored in `payment_mandates`.
- **Debit:** one request to take money under it. Stored in `payments`
  (the table slice 4 made for bond payments).
- **Idempotency key:** a label we send with each request so Stripe treats
  a repeat of the same request as the same one, not a new one.

## How a week's debit works

1. **The nightly rent run is unchanged** (`runRentJob` in
   apps/web/src/lib/ledger/rent-job.ts, 16:00 UTC): it adds each rent week
   as a charge line with its exact start (`period_starts_at`). Invoices are
   issued and emailed by the same run (`runBillingCatchUp`).
2. **A new nightly debit run**, its own scheduled call
   (`/api/cron/debits`, 18:00 UTC, after the rent run and its invoices),
   so the Renter has their invoice before the money moves and the debits
   get their own 300-second budget. It works one business at a time, in
   that business's tenant context (rule 3), using the existing
   `findDueOperators` and `forEachOperator` (apps/web/src/lib/jobs).
3. **Which businesses:** a new narrow database function
   `app.operators_with_debits_due()` returns only business IDs (like
   `operators_with_rent_due`): businesses not suspended or archived, with a
   Stripe account that is ready for BECS and not disconnected (the existing
   `loadPaymentAccount` state "ready" is checked again inside).
4. **Which rentals:** long-term rentals that are out (active), whose Renter
   has an active direct debit, and whose automatic debits are not paused.
5. **For each rental, in one short transaction with the rental locked**
   (the lock the rent run already takes, `lockBlockRental`):
   - find each rent week charged in the last 7 days that has no weekly
     debit yet (older weeks are left owing: no surprise catch-up of many
     weeks at once; see decision 3 below);
   - work out the scheduled amount: that week's rent as it stands (its
     charge plus any correction already added), plus the one-off charges
     and instalments due with it;
   - cap it at what is owing now less debits already pending; skip it if
     that leaves under 50c (Stripe's minimum, `STRIPE_MINIMUM_CHARGE_CENTS`);
   - **reserve the debit**: insert the `payments` row (pending, no Stripe ID
     yet) and its breakdown rows. The database's unique rule (rental + week
     start + attempt) refuses a second one, so two runs can't both reserve.
6. **After the transaction (Stripe is never called while rows are locked,
   as today)**, ask Stripe for the debit on the business's account, with
   the Renter's Stripe customer and direct debit, our payment's ID in its
   notes (metadata), a plain description ("Rent, week from 12 Nov 2026":
   no names), and the idempotency key `debit:{rentalId}:{weekStart}:{attempt}`.
7. **Save what Stripe answered** in a second short transaction: Stripe's
   payment ID, and either pending (BECS takes up to 3 business days) or
   failed with Stripe's reason code.
8. **Stripe's message when it clears or bounces** (thin event on the
   connected-accounts destination) is handled by the existing
   `handlePaymentEvent` (apps/web/src/lib/payments/payment-accounts.ts):
   business found from the event's account only, event ID recorded once,
   the payment read back from Stripe, never from the event. On success, in
   one transaction: status to succeeded, Stripe's fee saved, the payment
   line added to the ledger (method `becs_debit`, dated by when Stripe says
   the money moved, in the business's timezone) and linked to the payment.
   The receipt follows through the existing `issuePendingDocumentsQuietly`.

### When something goes wrong part way

- **Crash after reserving, before Stripe answered:** the next run finds the
  pending row with no Stripe ID. Within 23 hours it asks again with the
  same idempotency key (Stripe gives back the first answer; Stripe keeps
  keys for 24 hours). After that it lists the Renter's Stripe payments
  made since the reservation and matches our payment ID in their notes: if
  found, it is recorded; if not, the row is marked failed ("not sent") and
  never sent again (slice 6 decides about a retry).
- **Stripe's message arrives before step 7 saved the Stripe ID:** the event
  carries our payment ID in its notes; it is matched by that ID within the
  business, and only if the amount and customer agree with our row.
- **A lost Stripe message:** the debit run re-reads from Stripe any debit
  still pending after 5 business days' worth of calendar days (7 days).
- **The Renter changed bank during a debit:** the old direct debit is
  detached at Stripe (batch 2), so the debit in flight fails; the next
  debit uses the new one. Each debit records which direct debit it used.

## One-off charges

- The charge form on the rental page (`charge-form.tsx`) gains **"How to
  collect it"**, shown only when the business takes Stripe payments and the
  Renter has an active direct debit:
  - With the next weekly debit (default; from the rental's settings copy,
    rule 14);
  - Debit it on its own now (a separate debit made at once, after saving);
  - Split over [2 to 12] weekly debits (digits only, stops at 2 characters;
    the cents are spread so the instalments add up exactly, as
    `dailyShares` does for rent);
  - Don't debit it (if decision 2 is approved).
- The same choice is offered on "Charge the Renter" from a damage record.
- **The choice can be changed until the first part is debited**, logged.
- **Only charges added once the direct debit was active are swept in
  automatically.** Older charges (for example, ones the Renter was paying
  in cash) stay as they are; the business can debit them with "Debit
  what's owing now" (slice 6).
- A charge that is reversed before it is debited drops out of the plan.
- Settings → Payments gains the default ("One-off charges are collected:
  with the next weekly debit"), using the existing choice-setting form.

## Pausing a Renter's automatic debits

- The rental's Stripe card gets **Pause automatic debits** (reason required,
  "Are you sure?" via the shared ConfirmButton) and **Resume**. Both logged
  (rule 19). For a payment arrangement or a dispute; charges still go on
  the ledger and invoices still go out. Weeks charged while paused are not
  debited later automatically.

## Rate changes and the 30 days (decision 3)

- The change-of-rate form (Phase 3 slice 7a, rebuilt in batch 1) offers
  only rent-week starts at least 30 days ahead when the Renter has an active
  direct debit. Its wording: "from [date], or the first rent week starting
  30 days after you sign, if later". A late signature moves the start to
  that week; the signed form and the rate row say the actual start.
- A rental whose Renter sets up a direct debit after a change was signed
  keeps that change (they agreed it before authorising the debits).
- When Stripe confirms a shorter notice is enough for a change the Renter
  signed, the 30 becomes a named constant changed in one place.

## Screens

- **Rental page, Money card:** "Debit of $X pending since …" (not counted
  as paid); "Last debit $X cleared on …"; "Automatic debits paused" when
  paused.
- **Rental page, Stripe card** (`payments-card.tsx`): every debit listed
  with what it was for (week, one-off), amount, status, Stripe's fee once
  known, and Stripe's reason for a failure in plain words (e.g. "Not enough
  money in the account", "Over your Stripe direct-debit limit").
- **Charge form**: the "How to collect it" choice above.
- **Settings → Payments**: the one-off default.
- **Setup checklist**: the BECS-limit reminder shows again after a debit
  is refused for the limit (within 30 days).
- No new Renter screens: Stripe's emails, our invoices and receipts tell
  them.

All built from packages/ui pieces already there (ToggleGroup or Select,
Input, MoneyInput, ConfirmButton, Badge, the shared list). No new UI piece.

## Database changes (migration 0052)

Backwards compatible with the code before it (batch 6 rule), proved on a
filled database by CI's "update a filled database" check.

- **`payments`** (existing table, slice 4):
  - new purposes `scheduled_debit` and `one_off_debit` (enum values added
    to `payment_purpose`; rules in the same migration compare as text, as
    0041 did, because a new enum value can't be used in the transaction
    that adds it);
  - `stripe_checkout_session_id` becomes optional: required for bond
    payments only (debits have no Stripe page). The ID-shape check is
    rewritten to allow it empty;
  - `stripe_payment_intent_id` optional while the debit is reserved and not
    yet answered (debits only); set once, never changed;
  - new: `mandate_id` (the direct debit used; must be the same Renter's,
    enforced by a three-column link), `period_starts_at` (the rent week, for
    `scheduled_debit`), `attempt` (1 now; 2 for slice 6's retry),
    `stripe_fee_cents`, `requested_at`;
  - **one weekly debit per rental per week per attempt**: unique on
    (operator, rental, period start, attempt) where purpose is
    `scheduled_debit` (rule 20);
  - method stays a type (`becs_debit`), checked against the direct debit's
    method; no BECS-only columns (rule 16).
  - The trigger `check_payment_change` is replaced: amount, method,
    purpose, rental, Renter, direct debit, week and attempt never change;
    Stripe's IDs and fee may be filled once and never changed; status still
    only moves forward.
- **`debit_plans`** (new tenant table): how a one-off charge is collected:
  charge line, plan (`next_debit`, `own_debit`, `split`, and `not_debited`
  if decision 2 is approved), weeks (2 to 12 for
  `split`), who chose it. One per charge line. A change is refused by the
  database once any part has been put into a debit.
- **`debit_items`** (new tenant table): what each debit is made of: the
  payment, the charge line, the instalment number and its cents. Unique
  on (charge line, instalment), so a charge or instalment is put into a
  debit only once, whatever happens to that debit. Append-only.
- **`payment_ledger_lines`** (new tenant table): which ledger line came
  from which Stripe payment and why (`settled`, `refund`, `refund_failed`,
  `dispute_lost`, `dispute_won`), with the Stripe refund or dispute ID.
  Unique: one `settled` line per payment; one line per Stripe object and
  reason. This keeps Stripe's IDs out of the ledger table itself. Append-only.
- **`rentals`**: `debits_paused_at` and `debits_paused_reason` (changed only
  by Pause and Resume, logged).
- **`app.operators_with_debits_due()`**: narrow, returns IDs only.
- Every new table: `operator_id NOT NULL`, links that include
  `operator_id` (nothing can point at another business's row), row-level
  security on and forced, web app login only. The admin app gets no access
  (rule 5). Nothing changes existing money rows.

## Stripe pieces (behind the payments interface)

- `PaymentsProvider` (payments-provider.ts) gains `createDebit` (with the
  idempotency key), `readDebit` (status, reason code, amount, customer, our
  payment ID from its notes, Stripe's fee) and `findDebitByReference` (the
  23-hour recovery). The real one in stripe-provider.ts uses Stripe's
  PaymentIntents on the connected account; the stand-in
  (stand-in-provider.ts) gains the same, plus `settleDebit` for tests and
  signed events in Stripe's shape (decision 6).
- Refund and dispute handling (stripe-money-back.ts) learns rent debits:
  today `bondPaymentOf` ignores anything that isn't a bond. A refund of a
  debit adds a refund line, a failed refund reverses it, a dispute lost
  reverses the payment line, a dispute won adds a new payment line (a
  reversal of a reversal would not count in `owingCharges`, so it is a new
  line instead).
- New thin event types on the connected-accounts destination:
  `v1.payment_intent.processing`, `v1.payment_intent.succeeded`,
  `v1.payment_intent.payment_failed`. Abhi adds them, one step at a time.

## Build steps

1. **Core (packages/core):** scheduled amount (rent week + items, capped at
   owing less pending, 50c floor), instalment split, which weeks are due
   (7-day window), the 30-day rate-change rule, reason-code wording,
   idempotency key format. Unit tests to the cent.
2. **Database:** migration 0052 and database tests.
3. **Stripe interface:** real and stand-in methods, event handling,
   refunds and disputes for debits.
4. **Debit run:** `/api/cron/debits` route (vercel.json), the run, the
   recovery steps, the AGS alert email reused (`renderNightlyRunAlertEmail`).
5. **Screens:** Money and Stripe cards, charge form choice, pause and
   resume, Settings default, rate-change form, setup checklist.
6. **Demo data, test checklist rows, docs, deploy.** Then the full cycle
   once in Stripe's sandbox (decision 6) before any live business uses it.

## Tests

- **Money (core):** scheduled amount with and without one-off items;
  split instalments add up exactly (e.g. $100.00 over 3); cap when the
  Renter paid cash; under 50c skipped; credit balance means no debit.
- **Idempotency:** the debit run twice, or two at once, reserves and sends
  one debit; a crash after reserving is recovered without a second debit
  (within and after 23 hours); a Stripe message delivered twice adds one
  payment line; a message before step 7 is matched by our payment ID.
- **Ledger:** the payment line appears only on success; a dispute lost
  reverses it, won adds it back; balances always equal the sum of lines.
- **Tenant isolation:** business A can't read or change B's debits, plans,
  items or links; an event naming A's account can never touch B's payment
  even when its notes name B's payment ID.
- **Timezones:** a rent week starting across a daylight-saving change, and
  a Perth and a Sydney business in the same run, debit the right week once.
- **Rules:** suspended or not-ready businesses skipped; paused rentals and
  short hires skipped; weeks older than 7 days left owing; a reversed
  one-off dropped; a plan can't change after its first part is debited.
- **Browser (rule 33):** rental page with a pending, cleared and failed
  debit (stand-in), the charge form's choice, pause and resume with the
  keyboard at 375px, axe (WCAG 2.2 AA) and the rental page's download
  budget unchanged.

## Legal notes (to docs/legal-notes.md when built)

- **Direct Debit Request:** debits only the amounts the agreement allows,
  with Stripe's advance notices left on. The 30-day notice for a new rate
  (decision 3) stays until Stripe confirms otherwise (Abhi's question,
  already open).
- **Lawyer:** may a one-off charge such as damage or excess be debited
  without the Renter agreeing to that charge first? Australian Consumer Law
  and BECS disputes (up to 7 years, the bank's decision final) both bear on
  it. Until answered, the business chooses per charge and can pick "Don't
  debit it" (decision 2 below).
- **Privacy:** nothing new goes to Stripe beyond an amount and a
  description with no personal details (APP 8 already covers Stripe).
- **Record keeping:** debits and their ledger lines are tax records, kept
  at least 5 years, never removed by retention jobs.

## Decisions for Abhi (my recommendation first)

1. **Short hires are not debited automatically.** Their booked days are
   charged at pickup and are usually paid then (card or cash); a bank
   debit takes 3 business days, often longer than the hire. The business can
   still use "Debit what's owing now" (slice 6). Tradeoff: one more thing
   to collect by hand for short hires; in return no debit lands after the
   car is already back.
2. **One-off charges default to "with the next weekly debit"** (as approved),
   with a fourth choice "Don't debit it" for a charge the Renter disputes
   or pays another way. Tradeoff: one more option on the form; in return the
   business never debits a disputed damage charge by accident.
3. **Only the last 7 days of weeks are debited automatically.** A week
   missed for longer (a direct debit set up late, a pause, a suspension, a
   long outage) is left owing for the business to collect. Tradeoff: some
   money waits for a person; in return a Renter is never hit with several
   weeks in one surprise debit.
4. **A suspended business's debits stop while it is suspended** (rent and
   invoices go on as today until G3-6 is decided). G3-6 showed the run can
   keep charging for cars that came back while the business couldn't sign
   in; turning that into money taken from a bank is worse than an invoice.
   Tradeoff: a suspended business's Renters pay late; in return no bank
   debit rests on records nobody can correct. This differs from the 5 Nov
   choice that Renters keep paying online (their own, chosen payments),
   which stays.
5. **Stripe's fee is saved now; the payout each debit went out in waits for
   slice 8** (profit per car), where it is shown and used. Tradeoff: no
   payout matching for a few slices; in return no extra Stripe messages to
   handle before anything reads them.

## Senior review of this plan

- **Money:** integer cents throughout; the debit never exceeds what is
  owing less what is pending; the ledger changes only on Stripe's success
  (decision 2) and only by adding lines (rule 11). Found and fixed while
  writing: a dispute won can't be a reversal of the reversal (it would not
  count in `owingCharges`), so it is a new payment line.
- **Double debits:** three layers: the rental lock, the unique rule per
  week and attempt, and Stripe's idempotency key built from the same
  values. Found and fixed: Stripe keeps keys for only 24 hours, so a row
  stuck longer is looked up at Stripe, never sent blind.
- **Tenancy:** events matched by account only (rule 3); our payment ID in
  Stripe's notes is a pointer, checked against the business, amount and
  customer, never trusted alone. New tables carry `operator_id` in every
  link, with forced row-level security; admin has none (rule 5).
- **Wrong bank account:** each debit names its direct debit, and only the
  Renter's active one is used; batch 2 detaches replaced ones.
- **Database update:** found and fixed: a new enum value can't be used in
  the same transaction, and Drizzle runs all waiting updates in one, so the
  new rules compare purposes as text (as 0041 did) rather than splitting
  the update into two files.
- **Nightly time:** debits get their own call and budget; an unreached
  business is done the next night (inside the 7-day window). The existing
  launch-checklist item on splitting the nightly work covers debits too.
- **Naming:** the existing `businessDayOf` (payments/business-day.ts)
  means "the business's calendar day", not a banking day; slice 6's
  banking-day counting gets a distinct name so the two are never confused.
- **Logging:** no bank details, names or tokens in logs (rule 7); Stripe
  reason codes only.

## Not in this slice

- What happens after a failed debit (emails, retry, late fee, "Debit
  what's owing now", arrears list): slice 6.
- Refunding the bond or a credit through Stripe: slice 7.
- Payout matching and money on the dashboard: slice 8.
- PayTo: later; the method is already a type (rule 16).
