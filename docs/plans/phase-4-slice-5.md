# Phase 4 slice 5: weekly debits

Status: approved by Abhi on 9 Nov 2026, with decision 2 changed (see
"Decisions — approved 9 Nov"). First drafted 5 Nov 2026; brought up to date
against the code on 9 Nov 2026 (after business Renters slices 1 to 5, the
lock order and lock modes, and review fixes batches 1 to 7).

Outline already approved: docs/plans/phase-4.md (slice 5, decisions 1, 2, 3
and 6). Business Renters decision 6 (one weekly debit per car, approved
7 Nov). Design: docs/design/06-money.md (weekly cycle), 04 (rentals). Builds
on rent in 24-hour blocks (batch 1), bond and direct debit (batch 2, slice
4) and the lock order (docs/plans/business-renters.md, "Lock order" and
"Lock modes"). Rules 3, 7, 9, 11, 14, 16, 19, 20 and 32 apply throughout.

## What it delivers

- **The weekly debit.** For a long-term rental that is out, whose Renter
  has an active direct debit, the app asks Stripe to take that week's rent
  from the Renter's bank once the week has been charged, plus any one-off
  charges set to "with the next weekly debit". Only the **scheduled
  amount**, never the whole balance (design 06), and never more than is
  owing on that rental.
- **A business pays per car (business Renters decision 6).** Its one direct
  debit covers all its cars; each car's rental gets its own weekly debit,
  on its own ledger, receipt and statement line. A failed or disputed debit
  touches one car only.
- **One-off charges, collected how the business chooses:** invoiced only,
  not debited (the default, decision 2 as changed on 9 Nov), with the next
  weekly debit, taken now on their own, or split over 2 to 12 weekly
  debits.
- **The money counts only when Stripe says it arrived (decision 2).** Until
  then the rental shows "Debit of $X pending since Tue 10 Nov". When it
  clears, a payment line goes on the ledger and the receipt follows, as for
  any payment. A refund the business makes in Stripe, or a dispute the
  Renter's bank wins, adds a refund line; a dispute the business wins adds
  the payment back.
- **A debit never happens twice** for the same week, even if the run is
  repeated, crashes half way or Stripe's messages arrive twice or late.
- **Over the business's BECS limit:** Stripe refuses it; the debit shows as
  failed with "Over your Stripe direct-debit limit", and the Settings →
  Payments reminder to ask Stripe to raise the limits shows again. (What
  happens after any failure is slice 6.)
- **Rate rises for direct-debit Renters start at least 30 days after the
  Renter signs (decision 3)**, so a debit never takes a higher amount
  without the notice Stripe's Direct Debit Request promises.

## Words used here

- **Direct debit** (Stripe calls it a mandate): the Renter's permission,
  given on Stripe's page in slice 4, for the business to take money from
  their bank. Already stored in `payment_mandates`, one active per Renter
  (for a business: one for all its cars).
- **Debit:** one request to take money under it. Stored in `payments` (the
  table slice 4 made for bond payments).
- **Idempotency key:** a label sent with each request so Stripe treats a
  repeat of the same request as the same one, not a new one.
- **Rent week:** seven 24-hour blocks from the signed handover (batch 1),
  so a week starts at the handover's time of day, not on a set weekday. Its
  exact start is the rent line's `period_starts_at`.

## How a week's debit works

1. **The nightly rent run is unchanged** (`runRentJob` in
   apps/web/src/lib/ledger/rent-job.ts, called by `/api/cron/rent` at 16:00
   UTC): it adds each rent week as a charge line with its exact start, then
   `runBillingCatchUp` issues and emails the invoices. A week is charged in
   advance, as its first block starts (or at once by `chargeRentNow` after
   a handover or signed change).
2. **A new nightly debit run**, its own scheduled call (`/api/cron/debits`,
   18:00 UTC, in vercel.json beside the rent run), so the invoice is out
   before the money moves and the debits get their own 300-second budget.
   It works one business at a time in that business's tenant context (rule
   3), with the existing `findDueOperators` and `forEachOperator`
   (apps/web/src/lib/jobs/due-operators.ts). The rent route's `runPart`,
   `problemOf` and `sendAlert` move to lib/jobs and are shared, so the two
   routes don't repeat code (rule 30); the AGS alert is the existing
   `renderNightlyRunAlertEmail`.
3. **Which businesses:** a new narrow database function
   `app.operators_with_debits_due()` returns only business IDs (like
   `operators_with_rent_due`): businesses not suspended (`suspended_at` is
   empty; decision 4), whose Stripe account is connected, not disconnected
   and has BECS payments active. `loadPaymentAccount` is checked again
   inside (state "ready").
4. **Which rentals:** block-rent, long-term rentals that are out (active),
   whose Renter has an active direct debit and a Stripe customer, and whose
   automatic debits are not paused.
5. **For each rental, one short transaction with the rental locked first**
   (`ROW_LOCK`, "no key update"; the same rental lock the rent run and
   Stripe's bond news take, see "Lock order" below):
   - find each rent week that started in the last 7 days (exact time, not
     calendar days), is charged, has no weekly debit yet and is not the
     rental's first week (decision 6);
   - work out the scheduled amount: that week's rent as it stands (its
     charge plus any correction already added), plus the one-off charges
     and the next instalment of each split charge due with it;
   - cap it at what is owing on the rental now less its debits still
     pending; skip it if that leaves under 50c
     (`STRIPE_MINIMUM_CHARGE_CENTS`);
   - **reserve the debit**: insert the `payments` row (pending, no Stripe ID
     yet, the direct debit it will use) and its breakdown rows. The unique
     rule (rental, week start, attempt) refuses a second one, so two runs
     can't both reserve.
6. **After the transaction (Stripe is never called while rows are locked,
   as today)**, ask Stripe for the debit on the business's account: a
   PaymentIntent with the Renter's Stripe customer, the direct debit's
   payment method and mandate, confirmed off-session; our payment's ID in
   its metadata; a description with **no names** ("Rent 1BRT482, week from
   Thu 12 Nov 2026", the week in the business's timezone, so a business
   with several cars can match each debit to a car; never the driver or
   Renter); and the idempotency key `debit:{paymentId}` (one row is one
   request, whatever its purpose or attempt).
7. **Save what Stripe answered** in a second short transaction, the rental
   locked first, then the payment: Stripe's PaymentIntent ID (written once)
   and pending, or failed with Stripe's reason code if Stripe refused it. No
   answer (a timeout or Stripe down) leaves the row reserved for recovery;
   it is never marked failed on a guess.
8. **Stripe's message when it clears or bounces** (thin event on the
   connected-accounts destination) goes through the existing
   `handlePaymentEvent` (apps/web/src/lib/payments/payment-accounts.ts):
   business from the event's account only, the event ID recorded once
   (rule 20), the PaymentIntent read back from Stripe, never from the
   event. Then, as `applyCheckoutOutcome` and `applyMoneyTakenBack` do, the
   rental is locked first (`lockBondRental`, renamed `lockPaymentRental` as
   it now serves both), then the payment. On success: status succeeded,
   Stripe's fee saved, a payment line added (method `becs_debit`, dated by
   when Stripe says it happened, in the business's own day via
   `businessDayOf`) and linked to the payment. The receipt follows through
   `issuePendingDocumentsQuietly`, and the nightly `runBillingCatchUp`
   catches any it missed. Stripe's news is always recorded, whatever the
   rental's status (the money really moved). PaymentIntent events for a
   bond (handled by its Checkout events) or for anything not ours (no
   metadata, made in the business's own dashboard) are ignored.

### When something goes wrong part way

- **Crash after reserving, before Stripe answered:** the debit run looks at
  reserved rows with no Stripe ID that are over 15 minutes old (so it never
  races a request still under way). Within 23 hours it asks again with the
  same key (Stripe hands back the first answer; Stripe keeps keys for at
  least 24 hours). After that it lists the Renter's Stripe PaymentIntents
  made since the reservation and matches our payment ID in the metadata:
  if found, recorded; if not, marked failed ("not sent", reason
  `not_sent`) and never sent again. Slice 6 treats `not_sent` as ours, not
  the Renter's: no "your payment failed" email.
- **Stripe's message arrives before step 7 saved the Stripe ID:** it is
  matched by our payment ID in the metadata, within the business only, and
  only if the amount, customer and mandate agree with our row; the Stripe
  ID is then saved with it.
- **A lost message:** the debit run re-reads from Stripe any debit pending
  over 7 days and applies it through the same code as the event (a
  succeeded payment is never applied twice: one settled line per payment).
- **A refund or dispute about a debit whose Stripe ID isn't saved yet:**
  kept `not_ready` (Stripe sends it again), as `isBondPaymentAwaited` does
  for a bond: the check widens to "a debit of this business reserved before
  the event with no Stripe ID yet". Its alert after the hour says "payment",
  not "bond payment".
- **The direct debit cancelled or replaced during a debit:** a replaced
  one's bank account is detached at Stripe (batch 2), so a debit in flight
  on it fails and the next uses the new one. A mandate cancelled as the
  run reads it: Stripe refuses the debit (failed, with Stripe's reason).
  Each debit records which direct debit it used.
- **Cash recorded while a debit is pending:** both lock the rental, so one
  sees the other. The Record payment form warns "A debit of $X is on its
  way" before saving; an overpayment is a credit, refunded in slice 7.

## One-off charges

- The charge form on the rental page (`charge-form.tsx`) gains **"How to
  collect it"**, shown only when the business takes Stripe payments and the
  Renter has an active direct debit:
  - Invoice only, don't debit (the default for every one-off charge,
    decision 2 as changed on 9 Nov; from the rental's settings copy, rule
    14);
  - Take it with the next weekly debit (only while the rental is out);
  - Take it now (reserved after the charge is saved, in its own locked
    transaction, then sent as in steps 6 and 7);
  - Split over [2 to 12] weekly debits (digits only, stops at 2 characters;
    the cents spread so the instalments add up exactly, odd cents first, as
    `dailyShares` does for rent; only while the rental is out).
- A returned or cancelled rental has no more weekly debits, so it offers
  only "Take it now" and "Invoice only, don't debit".
- The same choice is offered on "Charge the Renter" from a damage record.
- **The choice can be changed until the first part is debited**, logged.
- **Only charges added once the direct debit was active are swept in
  automatically.** Older charges (for example, ones being paid in cash) stay
  as they are; slice 6's "Debit what's owing now" covers them.
- A charge reversed before it is debited drops out of the plan.
- A plan that never meets a weekly debit (the rental paused, returned, its
  business suspended, the direct debit cancelled) leaves the rest owing;
  the Money card says "Waiting for the next weekly debit".
- The default is one named constant (`DEFAULT_ONE_OFF_COLLECTION`, "Invoice
  only, don't debit") and a new key in the settings document, copied onto
  each rental (rule 14, no column); rentals made before it read the default.
  Settings → Payments shows it with the existing choice-setting form, since
  every setting is editable (rule 27).

## Pausing a Renter's automatic debits

- The rental's Stripe card gets **Pause automatic debits** (reason required,
  "Are you sure?" via the shared ConfirmButton) and **Resume**. Both lock
  the rental and are logged (rule 19). For a payment arrangement or a
  dispute; charges still go on the ledger and invoices still go out. Weeks
  that started while paused are not debited later. Per car: pausing all of
  a business's cars at once can come later.

## Rate changes and the 30 days (decision 3)

- The change-of-rate form (changes-card.tsx, `upcomingWeekStarts`) offers,
  when the Renter has an active direct debit, only rent-week starts at
  least 30 days ahead, for a **rise** (decision 7 for a fall). Its wording:
  "from [date], or the first rent week starting 30 days after you sign, if
  later". `isBlockRateChangeSignable` changes to match: signing late moves
  the start to that week instead of refusing it. The start is worked out at
  signing, under the change's lock, and both the signed PDF (made then) and
  the rate row state the actual first week.
- A Renter who sets up a direct debit after signing a change keeps that
  change (they agreed it before authorising the debits).
- The 30 is one named constant, so it changes in one place if Stripe
  confirms a shorter notice is enough (docs/progress.md Open items: "Confirm
  Stripe DDR notice rules"; still unanswered on 9 Nov, so 30 stays).

## Screens

- **Rental page, Money card:** "Debit of $X pending since …" (not counted
  as paid); "Last debit $X cleared on …"; "Automatic debits paused" when
  paused; "Waiting for the next weekly debit" beside a one-off planned for
  it.
- **Rental page, Stripe card** (`payments-card.tsx`): every debit listed
  with what it was for (week, one-off), amount, status, Stripe's fee once
  known, and Stripe's reason for a failure in plain words ("Not enough
  money in the account", "Over your Stripe direct-debit limit").
- **Record payment form:** the warning above when a debit is pending.
- **Charge form** and damage "Charge the Renter": "How to collect it".
- **A business's Money tab, How it pays card**: adds "Debits pending: $X
  across N cars" and the last one cleared (each car's detail stays on its
  rental).
- **Settings → Payments**: the one-off default ("Invoice only, don't
  debit" unless changed); the BECS-limit reminder
  shows again after a debit was refused for the limit in the last 30 days;
  a line saying to leave Stripe's emails to customers about direct debits
  on in the business's Stripe settings (decision 1 puts those settings in
  the business's hands, so the app can't hold them on).
- No new Renter screens. A person Renter, or a business's contact, sees
  Stripe's emails about each debit (the description names the car and
  week, no person) and our receipt for each car once it clears.

All built from packages/ui pieces already there (ToggleGroup or Select,
Input, MoneyInput, ConfirmButton, Badge, the shared list). No new UI piece.
Mockups of the changed cards first (rule 34).

## Database changes (migration 0063_weekly_debits)

Backwards compatible with the code before it (the 0062 code keeps running
while it is applied), proved on a filled database by CI's update check.
The old code never meets a debit row (only the new code makes them), and
its bond inserts and status updates all still pass the new rules.

- **`payments`** (existing table, slice 4):
  - new purposes `scheduled_debit` and `one_off_debit` on `payment_purpose`.
    A new enum value can't be used in the transaction that adds it, and
    Drizzle runs all waiting updates in one: checks compare
    `purpose::text` (as 0041 did), and **no index may**: tried on Postgres
    16, `purpose::text` in a partial index's WHERE is refused ("functions
    in index predicate must be marked IMMUTABLE"). So the one-per-week
    index keys on the week column instead (below);
  - `stripe_checkout_session_id` becomes optional: required for a bond
    only (`(purpose::text = 'bond') = (stripe_checkout_session_id is not
    null)`); the ID-shape check allows it empty;
  - `stripe_payment_intent_id` optional while a debit is reserved, and on
    one failed as never sent; required once succeeded; set once, never
    changed;
  - new: `mandate_id` (the direct debit used; the Renter's own, by a
    three-column link to a new unique `payment_mandates (id, renter_id,
    operator_id)`; required for a debit), `period_starts_at` (the rent
    week; set exactly when purpose is `scheduled_debit`), `attempt` (1 now;
    2 for slice 6's retry), `stripe_fee_cents` (0 or more), `requested_at`;
  - **one weekly debit per rental per week per attempt**: unique on
    (operator, rental, period_starts_at, attempt) where `period_starts_at`
    is not null (rule 20);
  - method stays a type (`becs_debit`), checked against the direct debit's;
    no BECS-only columns (rule 16);
  - `check_payment_change` is replaced: amount, method, purpose, rental,
    Renter, direct debit, week and attempt never change; Stripe's IDs and
    fee may be filled once and never changed; status still only moves
    forward. Column grants: `stripe_payment_intent_id`, `stripe_fee_cents`
    added to the web login's UPDATE list.
- **`debit_plans`** (new tenant table): how a one-off charge is collected:
  charge line, plan (`next_debit`, `own_debit`, `split`, `not_debited`),
  weeks (2 to 12, set exactly for `split`), who chose it. One per charge
  line; the line must be a charge of the same rental (three-column link).
  A change is refused by the database once any part is in a debit.
- **`debit_items`** (new tenant table): what each debit was planned from:
  the payment, the charge line (a rent week or a one-off), the instalment
  number and its cents. Unique on (charge line, instalment), so a part goes
  into one debit only, whatever happens to that debit. When the cap made
  the debit smaller than its items, the rest was already paid another way
  (payments pay the oldest charges first, `owingCharges`), so the items
  still count as dealt with. Append-only.
- **`payment_ledger_lines`** (new tenant table): which ledger line came
  from which Stripe payment and why (`settled`, `refund`, `refund_failed`,
  `dispute_lost`, `dispute_won`), with Stripe's refund or dispute ID.
  Unique: one `settled` per payment; one line per Stripe object and reason.
  Keeps Stripe's IDs out of the ledger table. Append-only.
- **`rentals`**: `debits_paused_at` and `debits_paused_reason`, set and
  cleared together (check), changed only by Pause and Resume; added to the
  web login's UPDATE grants.
- **`app.operators_with_debits_due()`**: narrow, returns IDs only, web
  login only.
- Every new table: `operator_id NOT NULL`, links that include
  `operator_id` and the rental (nothing can point at another business's or
  another rental's row), row-level security on and forced, SELECT and
  INSERT for the web login (UPDATE of the plan columns for `debit_plans`
  only), no delete or truncate. The admin login gets no access (rule 5).
  Nothing changes existing money rows.

## Lock order

Every new path takes the rental first and fits the one order in
docs/plans/business-renters.md. Rows to add to its table, after "Stripe's
news of a bond or direct debit …" (which becomes "… of a bond, a direct
debit or a debit"):

| Path | Locks, in order |
| --- | --- |
| Reserving a debit (the nightly run, "Debit it on its own now") | rental, then writes the payment and its items (Renter, direct debit and charge lines key shared) |
| Saving Stripe's answer, or the run's recovery of one | rental, the payment |
| Stripe's news of a debit (cleared or failed) | rental, the payment, the ledger line and its link |
| Stripe's news of a refund or dispute (bond or debit) | rental, the payment, then the bond entry or the ledger line and its link |
| Pausing or resuming automatic debits | rental |
| A one-off charge with how it is collected (charge form, damage) | rental, then writes the charge and its plan |
| Changing how a one-off charge is collected | rental, the plan |

- A Stripe event's own new record is written before the rental, as today;
  the payment is read unlocked first only to find its rental (its rental
  never changes), then locked after it.
- The direct debit is only read by the run, never locked: Stripe's
  mandate news (`applyMandateStatus`) locks only the direct debit and
  nothing after it, so the two can't wait on each other.
- Saving Stripe's PaymentIntent ID writes a column with a unique key, so
  Postgres takes that payment row FOR UPDATE for the write. Every write
  that links to a payment (its items, its ledger links, a bond entry, slice
  6's retry) is under the rental's lock, so nothing waits on it there. Add
  it to "Kept as FOR UPDATE" with that reason.
- Two-connection tests: the run against Stripe's success message, against
  a cash payment, against Pause, and against a one-off charge, each in both
  orders: one waits for the other, no deadlock (40P01).

## Stripe pieces (behind the payments interface)

- `PaymentsProvider` (payments-provider.ts) gains `createDebit` (with the
  idempotency key; says "refused" with Stripe's code, or throws for no
  answer), `readDebit` (status, reason code, amount, customer, mandate, our
  payment ID from its metadata, Stripe's fee) and `findDebitByReference`
  (the 23-hour recovery). The real one (stripe-provider.ts) uses
  PaymentIntents on the connected account; the stand-in
  (stand-in-provider.ts) gains the same, plus `settleDebit` for tests and
  signed events in Stripe's shape (decision 6 of phase 4).
- Refunds and disputes (stripe-money-back.ts): `bondPaymentOf` becomes
  `stripePaymentOf` (any purpose); a bond goes on as today, a debit goes to
  the ledger the same way the bond side does: a refund or a dispute lost
  adds a **refund line** of the amount Stripe moved; a refund that failed
  reverses that refund line; a dispute won adds a new payment line. A
  dispute lost is a refund line, not a reversal of the payment, because
  the bank can take a different amount from the debit (after a part
  refund), and a reversal must undo a line exactly. The debit's own status
  is not changed by refunds (the lines say what moved).
- **Stripe's payment lines can't be reversed by hand.** Today the ledger's
  Reverse offers any payment line; one from Stripe is changed only by
  Stripe's news, otherwise a dispute later would take it back twice.
- New thin event types on the connected-accounts destination:
  `v1.payment_intent.processing`, `v1.payment_intent.succeeded`,
  `v1.payment_intent.payment_failed`. Abhi adds them once the code is live
  (one step at a time), and they go on the launch checklist's list for the
  live destination.

## Build steps

1. **Core (packages/core):** scheduled amount (rent week plus items, capped
   at owing less pending, 50c floor), instalment split, which weeks are due
   (7 days, not the first week), the 30-day rate-rise rule, reason-code
   wording, the description. Unit tests to the cent.
2. **Database:** migration 0063 and database tests (on a database filled at
   0062).
3. **Stripe interface:** real and stand-in methods, event handling, refunds
   and disputes for debits, no hand reversal of Stripe's lines.
4. **Debit run:** `/api/cron/debits` (vercel.json), the run, recovery, the
   shared nightly-run helpers.
5. **Screens:** mockups, then Money and Stripe cards, charge form choice,
   pause and resume, Record payment warning, business How it pays,
   Settings, rate-change form.
6. **Demo data, test checklist rows, docs, deploy.** Then the full cycle
   once in Stripe's sandbox on the dev site (below) before any live
   business uses it.

## Tests

- **Money (core):** scheduled amount with and without one-off items; split
  instalments add up exactly (e.g. $100.00 over 3 is $33.34, $33.33,
  $33.33); cap when the Renter paid cash; under 50c skipped; credit means
  no debit; a business's credit on one car never lowers another car's
  debit.
- **Idempotency:** the run twice, or two at once, reserves and sends one
  debit; a crash after reserving is recovered without a second debit
  (within and after 23 hours; a row under 15 minutes old is left alone);
  a message delivered twice adds one payment line; a message before step 7
  is matched by our payment ID; the 7-day re-read and the message together
  add one line.
- **Ledger:** the payment line appears only on success; a refund and a
  dispute lost add refund lines, a failed refund reverses its line, a
  dispute won adds a payment line; a part refund then a dispute; Stripe's
  payment lines refused by hand reversal; balances always equal the sum of
  lines.
- **Tenant isolation:** business A can't read or change B's debits, plans,
  items or links; an event naming A's account never touches B's payment,
  even when its metadata names B's payment ID; the admin login reads none.
- **Timezones:** a rent week starting across a daylight-saving change is
  debited once (blocks are exact hours); its description and payment date
  are in the business's day; a Perth and a Sydney business in the same run.
- **Rules:** suspended or not-ready businesses skipped; paused rentals,
  short hires and first weeks skipped; weeks over 7 days old left owing; a
  reversed one-off dropped; a plan can't change after its first part; a
  returned rental offers no weekly choice; a business's three cars get
  three debits on its one direct debit.
- **Lock order:** the two-connection tests above.
- **Database update:** on a database filled at 0062: existing bond payments
  unchanged, the 0062 code still records a bond, the new rules refuse a
  second debit for a week, a debit on another Renter's direct debit, a
  changed amount, and a change to a plan already debited.
- **Browser (rule 33):** rental page with a pending, cleared and failed
  debit (stand-in), the charge form's choice, pause and resume, with the
  keyboard at 375px; axe (WCAG 2.2 AA); the rental page's download budget
  unchanged.

## Legal notes (to docs/legal-notes.md when built)

- **Direct Debit Request (BECS):** debits only amounts the rental contract
  sets, through Stripe's DDR the Renter accepted. Rate rises wait 30 days
  (decision 3) until Stripe answers the open question. Stripe's own
  emails about each debit are the business's Stripe settings; Settings →
  Payments asks the business to leave them on.
- **Lawyer:** may a one-off charge such as damage or excess be debited
  without the Renter agreeing to that amount first? Australian Consumer Law
  (unfair terms, the Renter's fair chance to dispute) and BECS disputes (up
  to 7 years, the bank's decision final) both bear on it. Until answered,
  every one-off charge defaults to "Invoice only, don't debit" (decision 2
  as changed on 9 Nov) and the business chooses per charge.
- **Consumer law:** no surprise catch-up of missed weeks (decision 3); the
  first week is collected at pickup, not debited on top (decision 6).
- **Spam Act:** nothing new is sent by us here; receipts are transactional.
  Slice 6's failure emails are the same.
- **Privacy:** only an amount and a description go to Stripe (the car's
  rego and the week; no person's name), beyond what slice 4 already sends
  (APP 8 covers Stripe). No bank details, names or tokens in logs (rule 7).
- **Record keeping:** debits, their items and ledger links are tax records,
  kept at least 5 years, never removed by retention jobs.

## Decisions — approved 9 Nov

Abhi approved the plan on 9 Nov 2026. Each decision as it now stands:

1. **Short hires are not debited automatically.** Booked days are charged
   at pickup and usually paid then; a bank debit takes 3 business days,
   often longer than the hire. (Adopted as recommended.)
2. **One-off charges default to "Invoice only, don't debit"** (changed by
   Abhi; supersedes the 5 Nov "with the next weekly debit" default). This
   covers all of them: damage, excess, cleaning, towing, admin fees,
   anything that is not weekly rent. Per charge the business can choose
   instead "Take it with the next weekly debit", "Take it now", or "Split
   over 2 to 12 weekly debits". Why: no disputed charge is taken from a
   Renter's bank without their agreement (Australian Consumer Law unfair
   terms; BECS disputes, up to 7 years, the bank's decision final), and it
   matches how businesses work (extras are invoiced, or taken from the bond
   at the close). The default is a named constant and a key in the
   settings copy on each rental (rule 14).
3. **Only rent weeks that started in the last 7 days are debited
   automatically.** A week missed for longer (a direct debit set up late, a
   pause, a suspension, an outage) is left owing for the business to
   collect. (Adopted as recommended.)
4. **A suspended business's debits stop while it is suspended**; its rent
   and invoices are unchanged. Weeks missed are not caught up (decision 3).
   (Adopted as recommended.)
5. **Stripe's fee is saved now; payout matching waits for slice 8.**
   (Adopted as recommended.)
6. **The first rent week is not debited automatically.** It is charged at
   the handover, usually taken with the bond. (Adopted as recommended.)
7. **The 30 days' notice applies to rate rises only**; a lower rate starts
   from any week after signing, as today. (Adopted as recommended.)
8. **Stripe's payment lines can't be reversed by hand**, and a dispute lost
   is a refund line of what the bank took. (Adopted as recommended.)
9. **One debit per car per week for a business**, each described by rego
   and week only, never a person. (Adopted as recommended.)

## Senior review of this plan

- **Money:** integer cents throughout; a debit never exceeds what is owing
  on its rental less what is pending; the ledger changes only on Stripe's
  news (decision 2) and only by adding lines (rule 11). Fixed on 9 Nov: a
  dispute lost after a part refund would have reversed the whole payment;
  now a refund line of what the bank took. A capped debit's items still
  sum above its amount; that is right, and said so, as the rest was paid.
- **Double debits:** the rental lock, the unique rule per week and attempt,
  Stripe's key (now the payment row's ID, so it fits one-off debits and
  slice 6's retry too), recovery that never sends blind after 23 hours and
  never touches a row under 15 minutes old. Fixed on 9 Nov: a Stripe
  payment line could be reversed by hand and then taken back again by a
  dispute; the first week could be debited on top of cash taken at pickup.
- **Database update:** fixed on 9 Nov: the 5 Nov plan's one-per-week index
  compared the new purpose as text in its WHERE, which Postgres refuses;
  the index keys on the week column instead, and a check ties the week to
  the purpose. Migration number 0063 (was 0052).
- **Locks:** every path takes the rental first; Stripe is never waited on
  with a row locked; the one implicit FOR UPDATE (saving Stripe's ID) is
  under the rental's lock. Fixed on 9 Nov: the 5 Nov plan used the rent
  run's private `lockBlockRental`; the shared rental lock is used instead.
- **Tenancy:** events matched by account only (rule 3); our payment ID in
  Stripe's metadata is a pointer, checked against the business, amount,
  customer and direct debit, never trusted alone. New tables link by
  `operator_id` and rental, forced row-level security; admin has none.
- **Webhooks:** each event once by its ID; a refund or dispute for a debit
  not yet saved waits (`not_ready`) rather than being lost, as bonds do;
  PaymentIntent events for bonds or for the business's own Stripe
  payments are ignored.
- **Business Renters:** one direct debit, many debits; driver changes don't
  touch them (the debit is the rental's and the business's); no person is
  named to Stripe; a business's credit on one car never covers another.
- **Timezones:** weeks are exact 24-hour blocks; only dates shown and the
  payment line's day use the business's timezone.
- **Nightly time:** debits get their own call and budget; an unreached
  business is done the next night, inside the 7 days. The launch
  checklist's item on splitting the nightly work covers debits too. A
  business with many cars can reach its weekly BECS limit in one night:
  later cars fail with the limit reason and the reminder shows.
- **Naming:** `businessDayOf` means the business's calendar day, not a
  banking day; slice 6's banking days get a distinct name.
- **Stale docs found:** design 06 still says "Connect Express" (decision 1
  replaced it), "on the charge day" (now 24-hour blocks), and "Failed
  payments: reverse the payment line" (decision 2 adds none until
  success). Brought up to date in build step 6. Slice 6's plan uses the old
  key format `debit:{rentalId}:{weekStart}:2`; it changes to the payment
  ID with this.

## What Abhi needs to do (one step at a time, when we get there)

- Once the code is on the dev site: add the three PaymentIntent event
  types to the sandbox's connected-accounts destination.
- Then, on the dev site with Stripe's sandbox (the cloud session can't
  reach Stripe), the full cycle once with Stripe's test bank accounts
  (one that succeeds, one that fails, one that is disputed), together with
  the launch checklist's open sandbox checks (refund and dispute events
  arriving thin from the connected-accounts destination; which event a
  disconnect sends with Accounts v2; detaching a replaced direct debit
  sends "mandate updated" inactive), plus: a repeated request with the
  same key gives the same debit, and the reason Stripe gives over the
  BECS limit.
- Still open, not blocking (30 days is the safe default): Stripe's answer
  on the DDR notice for a changed amount.

## As built (9 Nov 2026)

Built as planned, with decision 2 as Abhi changed it: every one-off charge
starts as "Invoice only, don't debit" (`DEFAULT_ONE_OFF_COLLECTION`, the
settings key `oneOffChargeCollection` copied onto each rental, rule 14);
per charge the business picks "Take it with the next weekly debit", "Take
it now" or "Split over weekly debits" (2 to 12).

- **Core** (packages/core/src/weekly-debits.ts): the scheduled amount
  (`scheduledDebitCents`), the split (`instalmentShares`), which weeks are
  due (`isRentWeekDebitable`), a week's rent as it stands
  (`rentWeekCents`), the 30 days' notice (`RATE_RISE_NOTICE_DAYS`,
  `firstWeekAfterNotice`, `signedRateChangeStartBlock`), recovery steps,
  Stripe's reasons in words and the description by car and week.
- **Database** (migration 0063): as in "Database changes", plus a
  constraint trigger checking each ledger link matches its reason (a
  cleared debit's line is a payment of exactly its amount once it
  succeeded), and a trigger refusing a reversal by a person of a line
  Stripe's news made (decision 8, also refused in the app). The owner gets
  a read policy on payments for `operators_with_debits_due`, which also
  names a business with a debit still pending (recovery and the 7-day
  re-read finish work already started, even while it is suspended; no new
  debit is made then).
- **Debit run** (apps/web/src/lib/debits): `/api/cron/debits` at 18:00 UTC,
  `runPart` and the alert shared with the rent route in
  `lib/jobs/nightly-run.ts`. `requested_at` is set when the debit is
  reserved; recovery waits 15 minutes from it.
- **Stripe's news**: PaymentIntent events read back from Stripe; a bond's
  own PaymentIntent and one made in the business's dashboard carry no
  payment ID of ours and are ignored. The receipt follows at once
  (`afterLedgerLines` on the payments dependencies), the nightly billing
  catch-up issues any it missed.
- **Screens**: Money card, Stripe card (debits listed, Pause and Resume),
  charge form and damage's Charge the Renter, changing a charge's plan
  (a "How it's collected" button beside it until a part is debited),
  Record payment's warning, a business's How it pays card, Settings →
  Payments, and the change-of-rate form.

Departures, each for a reason:

1. **Settings → Payments keeps the one-off default control.** Abhi said it
   is not needed unless the plan requires it; rule 27 says every setting is
   editable, so the key the rentals copy has its control (the existing
   choice-setting form), starting at "Invoice only, don't debit", with a
   hint that invoice only is safest.
2. **"Weeks begun while paused are not debited later"** reads when the
   debits were last resumed from the resume's own activity log entry
   (written in the same transaction), as the plan's columns
   (`debits_paused_at`, `debits_paused_reason`) are cleared on resume. A
   `debits_resumed_at` column would be cleaner but is a schema change
   beyond the plan, so it is on the launch checklist for Abhi to decide.
3. **Pause asks for its reason in a pop-up** (the shared reason form),
   which is itself the "are you sure"; Resume uses the shared
   ConfirmButton.
4. **No mockups were made**: the changed cards use only pieces already in
   packages/ui and the approved look. Abhi to look at the rental page on
   the dev site and say if any wording or layout should change.
5. **A one-off debit's description** is "Charges 1BRT482, Tue 10 Nov 2026"
   (the plan named only the weekly one). After a car swap, a debit names
   the rental's car now.
6. **No demo data for debits**: debits need Stripe (the demo data runs
   without it).
7. **The three-car test** gives one Renter three rentals on one direct
   debit (the debit logic is per Renter and per rental, a business or a
   person alike).

Review fixes (9 Nov 2026): a reversed charge is never taken now nor
re-planned; a debit marked not sent that Stripe says succeeded becomes
succeeded with its payment line (the only way back the database allows),
and one Stripe refused that later succeeds alerts AGS; recovery looks
debits up from ten minutes before they were reserved and asks Stripe
again only while the debit could still be made; a rise moved by the
notice is out of time once its start reaches a later signed rate, and the
moved start and the check are worked out inside the signing transaction.
The rest are on the launch checklist ("Weekly debits leftovers").

## Not in this slice

- What happens after a failed debit (emails, retry, late fee, "Debit
  what's owing now", arrears list): slice 6.
- Refunding the bond or a credit through Stripe: slice 7.
- Payout matching and money on the dashboard: slice 8.
- One combined weekly debit for a business's cars; pausing all its cars at
  once: later.
- PayTo: later; the method is already a type (rule 16).
