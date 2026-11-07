# Phase 4 slice 6: failed payments and arrears

Status: draft for Abhi's approval (5 Nov 2026). Touches money, schema and
Stripe: nothing is built until approved.

Outline already approved: docs/plans/phase-4.md (slice 6). Design:
docs/design/06-money.md (failed payments, arrears). Builds on slice 5
(docs/plans/phase-4-slice-5.md: debits as `payments` rows, `debit_items`,
the debit run at `/api/cron/debits`), which must be built first. Rules 3,
9, 11, 14, 19 and 20 apply throughout.

Note on design 06: it says "reverse the payment line" on a failure. Since
decision 2 (a payment counts only once Stripe says it succeeded), a failed
debit never had a ledger line, so nothing is reversed: the charge simply
stays owing. A debit that bounces after succeeding arrives as a dispute,
which slice 5 already reverses.

## What it delivers

- **When a debit fails, people are told at once:** the business by a
  "Needs attention" alert on the dashboard and an email; the Renter by email
  (SMS once a provider is chosen), with the amount and what happens next.
  The alert is Needs attention's existing red "Overdue" line (built 7 Nov
  2026, docs/plans/look-slice-2-overdue.md): slice 5 makes a failed debit
  overdue at once through `overdueOf` (see its TODO), so this slice adds
  no second kind for it.
- **One automatic retry** after 3 banking days (a setting), counting
  weekends and the national and the business's state public and bank
  holidays. Only when the failure can be fixed by waiting (e.g. not enough
  money). If the retry fails, no more tries: the rental is flagged for the
  business.
- **Late fee** (off by default): when on, one fee per missed rent week,
  after the business's grace days (the one shared setting, default 2),
  only if the Renter's signed contract states it.
- **Debit what's owing now:** a button on the rental for the business to
  debit the amount owing, or part of it, at once. Logged, one at a time.
- **Arrears list ("Owing"):** every Renter owing, how long (current, 1 to 7,
  8 to 14, 15 to 30, over 30 days), the last payment, and links to the
  rentals. The dashboard's "Owing" count (moved here from slice 1).
- **A direct debit cancelled by the Renter's bank** while a rental is out
  is an alert and an email to the business, since no more debits can work.

## Words used here

- **Banking day:** a weekday that is not a public or bank holiday in the
  business's state or nationally. Not the same as the existing
  `businessDayOf` (payments/business-day.ts), which means "the business's
  own calendar day"; the new helper is named `addBankingDays` so the two
  are never mixed up.
- **Arrears:** money owed and past its due day.

## Failed debits

- Stripe's "payment failed" message (slice 5's handling in
  `handlePaymentEvent`) moves the debit to failed with Stripe's reason
  code. After that transaction:
  - the business gets an email: Renter, rental, amount, the reason in plain
    words, and what happens next ("We'll try again on Thu 19 Nov" or "No
    more automatic tries");
  - the Renter gets an email: the amount, that their bank did not pay it
    (never the exact reason: it may be private), the retry date if any, and
    how to pay instead (the business's "How to pay" text and contact);
  - each email is sent once: a notice row per debit and audience, made
    before sending; a failed send is retried by the debit run, at most for
    3 days (then the dashboard alert is the record).
- The dashboard's **Needs attention** lists: failed debits whose money is
  still owing, debits that failed twice, and active rentals whose direct
  debit was cancelled. Each links to the rental. An item clears itself
  when the money owing for it is paid, credited or reversed.
- The rental's Money and Stripe cards show the failure, its plain reason,
  the retry date or "No more automatic tries", and the "Debit what's owing
  now" button.
- Emails are transactional (about this rental's payment, no marketing), so
  the Spam Act's unsubscribe rule does not apply; they name the business.

## The automatic retry

- **Which failures are retried:** only reason codes meaning the account
  still works and waiting may help (e.g. not enough money). Never a closed
  account, a cancelled or unauthorised direct debit, or one over the
  business's Stripe limit: retrying those breaks the Direct Debit Request
  or cannot work. The list is a named constant in packages/core, its exact
  codes confirmed in the sandbox run.
- **Which debits:** weekly debits and one-off debits on their own (slice 5);
  never the business's own "Debit what's owing now" (they decide).
- **When:** the failure's day (Stripe's time, in the business's timezone)
  plus the retry setting in banking days (default 3, 1 to 5, digits only;
  0 turns retries off). The debit run (slice 5) does it on the first run on
  or after that day.
- **How much:** the failed debit's amount, capped again at what is owing
  less what is pending, so a Renter who paid in the meantime isn't debited
  twice. Under 50c: no retry.
- **Which direct debit:** the Renter's active one at the time of the
  retry (a new bank account set up since is used).
- **Once only:** the retry is a new `payments` row with attempt 2 for the
  same week, linked to the failed one; slice 5's unique rule (rental, week,
  attempt) and a unique link (one retry per failed debit) refuse a second.
  Idempotency key `debit:{rentalId}:{weekStart}:2`, so Stripe never takes
  it twice either.
- **Not while suspended or paused:** the same checks as the weekly debit.
  A retry whose day passed while the business was suspended is not made
  later; the money stays owing.
- **Settings:** Settings → Payments, "Try a failed debit again after
  [3] banking days". Copied onto each rental (rule 14); older rentals read
  the default, 3.

### Banking days: the holiday library (rule 32)

Checked 5 Nov 2026 with `npm view`:

| Candidate | Licence | Latest release | Notes |
|---|---|---|---|
| **date-holidays** | ISC (code) and CC-BY-3.0 (holiday data) | 3.38.0, 24 Oct 2026 (12 days old: too new); **3.37.0, 20 Sep 2026** | Every Australian state, public and bank holidays, substitute days. One maintainer. About 11 MB installed; brings date-holidays-parser 3.4.7 (ISC, last released Feb 2025), moment-timezone, astronomia and others. |
| Our own list | none | n/a | Dates from the government's published lists (data.gov.au, CC BY 4.0), updated by hand each year. |
| Nager.Date | MIT (service) | hosted API | A call to an overseas server during the nightly run. |

**Recommendation: date-holidays, pinned at exactly 3.37.0**, used only on
the server (exported from packages/core's server entry, so none of it
reaches a phone's download), counting holidays of type "public" and
"bank" (banks shut on a NSW Bank Holiday, which matters for BECS). A test
compares 2026 to 2028 for every state with the state governments'
published lists, so a wrong date in the library fails CI. With no state in
Business details, only national holidays count, and Settings → Payments
says "Add your state in Business details so its holidays count".

## Late fee

- **Settings → Payments:** "Charge a late fee" (off by default) and the
  amount (money box). Its grace is the business's one **grace days**
  setting, `paymentGraceDays` (default 2, 0 to 30, digits only), already
  on Settings → Payments as "Count as overdue after [2] days" and used by
  Needs attention's Overdue (docs/plans/look-slice-2-overdue.md, approved
  by Abhi 7 Nov 2026: one setting, not two). The late fee and its grace
  days are copied onto each rental (rule 14) because they charge money:
  turning the fee on, or changing the grace days, affects new rentals only;
  older ones read "off". Needs attention keeps reading today's setting, as
  it only shows things.
- **Only if the contract says so:** a new merge field "Late fee" for
  contract templates prints the amount and grace days. A rental gets late
  fees only if its signed contract's template contains that field (checked
  with the existing `missingMergeFields`); the template page warns when the
  setting is on and the field is missing, as batch 1 does for price terms.
- **Missed payment:** a rent week's charge still owing (not covered by
  payments, credits or a pending debit) once its grace days have passed.
  This is the same for every Renter, however they pay.
- **Once per missed week:** the daily rent run adds one late-fee line,
  using the built-in `late_fee` charge type (its GST treatment, rule 9),
  linked to the rent charge it is for. A unique rule allows only one per
  rent charge, so a re-run never adds it twice (rule 20). It is invoiced
  and collected as a one-off charge (slice 5's default).
- Reversing a late fee works as for any charge, logged.

## Debit what's owing now

- On the rental's Money card, when the Renter has an active direct debit
  and the business is ready for Stripe payments: amount (money box, filled
  with what is owing less what is pending; at least 50c, at most that),
  and an "Are you sure?" with the amount and the Renter's name.
- **One at a time:** a database rule allows one pending "owing now" debit
  per rental; a second press, or a second phone, gets "A debit of $X is
  already on its way".
- Reserved, sent and recorded the same way as slice 5 (reserve, then ask
  Stripe after the transaction, idempotency key from the payment's own ID),
  logged with the User as the actor (rule 19). Never retried automatically.
- Refused while suspended, paused, or with the direct debit not active.

## Arrears list

- **New page "Owing"** (in the navigation; its path in lib/paths.ts), on the
  shared list (RecordList: a table on wide screens, cards on phones, rule
  24). One row per Renter owing: name, total owing, an amount per age band
  (current, 1 to 7, 8 to 14, 15 to 30, over 30 days), debits pending shown
  apart, last payment (date and amount), flags (debit failed twice, direct
  debit cancelled), and their rentals. Sort by amount or oldest; filter by
  age band (nuqs, as other lists).
- **Worked out from the ledger every time (rule 11):** `owingCharges`
  (packages/core/src/ledger.ts) already pays off the oldest charges first;
  a new core function adds the age bands, counting in the business's
  calendar days. Money pending by debit covers the oldest owing charges
  first and is shown as "pending", not aged.
- **Dashboard:** "Owing: N Renters, $X" linking to the list.
- Admin sees none of it (rule 5).

## Screens

Owing page; Needs attention items; Money and Stripe card wording; Debit
what's owing now; Settings → Payments (retry days, late fee); the template
page's late-fee warning. All from existing packages/ui pieces (RecordList,
MoneyInput, Input, ConfirmButton, Badge, ToggleGroup). Two new emails in
packages/email (business and Renter), one for the cancelled direct debit
(business), from the shared email layout.

## Database changes (migration 0053, after slice 5's 0052)

Backwards compatible, proved on a filled database (batch 6).

- **`payments`:** purpose `owing_now` (rules compare it as text, as in
  0052); `retry_of_payment_id` (a link within the same business and
  rental, unique: one retry per failed debit; only attempt 2 has one); a
  rule that one pending `owing_now` debit per rental at most; `created_by_user_id`
  for "owing now".
- **`debit_failure_notices`** (new tenant table): payment, audience
  (business or Renter), sent at, tries. Unique (payment, audience). Never
  holds the email's text or address.
- **`late_fees`** (new tenant table): the rent charge line and the late-fee
  line it made. Unique on the rent charge line. Append-only.
- **`mandate_cancel_notices`** (new tenant table): the direct debit and
  when the business was told; unique per direct debit.
- Every new table: `operator_id NOT NULL`, links including `operator_id`,
  row-level security on and forced, web app login only.
- Settings (retry days, late fee) live in the existing settings document
  (Zod schema in packages/core/src/settings.ts); no column. Grace days is
  the existing `paymentGraceDays` there, not a new setting.

## Build steps

1. **Core:** banking days (`addBankingDays`, with the holiday library),
   retryable reason codes, retry amount, late-fee rule, age bands. Tests.
2. **Database:** migration 0053, database tests.
3. **Server:** failure handling and emails, the retry in the debit run,
   late fees in the rent run, "Debit what's owing now", the cancelled
   direct debit alert.
4. **Screens:** Owing page, dashboard, rental cards, settings, merge field
   and warning.
5. **Demo data, test checklist rows, docs, deploy;** then the failure and
   retry cycle in Stripe's sandbox with its failing test bank accounts.

## Tests

- **Banking days:** a failure on a Friday, before Easter, before
  Christmas and New Year, on a state-only holiday (WA Day, Melbourne Cup in
  Melbourne only if the library marks it so), a NSW Bank Holiday, a
  business with no state; across a daylight-saving change.
- **Retry:** made once, on the right day; never for a closed account or
  cancelled direct debit; capped after a cash payment; skipped while
  suspended or paused; the run twice makes one retry; the retry fails and
  no third try is made; the rental is flagged.
- **Late fee:** off by default; only with the contract field; once per
  missed week (run twice adds one); none while a debit is pending; GST per
  the type; none when paid inside the grace period.
- **Debit what's owing now:** two presses make one debit; amount over
  what is owing refused on the server as well as the screen.
- **Emails:** sent once each; a failed send retried; nothing private in
  them or in logs (rule 7).
- **Arrears:** age bands to the day, oldest-first allocation, pending
  shown apart, credits, reversals; Perth and Sydney businesses.
- **Tenant isolation:** business A can't see B's Owing list, notices or
  late fees; a failed-payment event on A's account can't notify B's Renter.
- **Browser (rule 33):** the Owing page at 375px and wide (cards and
  table), keyboard only, filters; Debit what's owing now with "Are you
  sure?"; settings forms; axe (WCAG 2.2 AA); download budgets for the new
  page and the rental page.

## Legal notes (to docs/legal-notes.md when built)

- **Late fees (lawyer):** must be in the signed contract (built in) and
  must not be a penalty: a fee far above the business's real cost of a late
  payment can be unenforceable, and an unfair term under the Australian
  Consumer Law. Operator terms should say the business sets the amount and
  answers for it.
- **Retrying and ad hoc debits (Stripe and lawyer):** the Direct Debit
  Request must allow a retry and a debit of an amount owing outside the
  weekly schedule; check Stripe's service agreement wording. Retrying a
  cancelled or unauthorised direct debit is never done.
- **Telling the Renter:** the email gives the amount and what happens next,
  never the bank's reason (privacy, APP 11); it is transactional (Spam
  Act).
- **Hardship:** a business should be told it can pause debits (slice 5)
  for a payment arrangement; worth a line in the Operator help text.
- **Holiday data licence:** date-holidays' holiday data is CC-BY-3.0, which
  needs attribution: it goes in the third-party licences file (already on
  the launch checklist).
- **Record keeping:** failure notices and late fees are kept with the
  ledger (at least 5 years).

## Decisions for Abhi (my recommendation first)

1. **The holiday library: date-holidays 3.37.0**, with its CC-BY-3.0 data
   licence accepted (attribution only). CLAUDE.md rule 32 lists only code
   licences, so this needs your yes. Tradeoff: one maintainer and a large
   install (server only); in return every state's holidays are kept for us.
   The alternative is our own yearly list from the government's data.
2. **A late fee applies to every Renter who misses a week**, however they
   pay, not only after a failed debit. Tradeoff: a cash Renter can get one
   too; in return everyone is treated the same, which is fairer and easier
   to defend.
3. **The Renter's email gives no bank reason**, only that the bank didn't
   pay it. Tradeoff: they may need to ask their bank why; in return nothing
   private about their account is put in an email.
4. **SMS waits for a provider** (as approved); until then email only, and
   the rental page shows the business the Renter's phone to call.
   Tradeoff: a Renter who misses the email learns later; in return no
   provider is picked in a hurry.

## Senior review of this plan

- **Money:** nothing added to or taken from the ledger on a failure
  (decision 2); a retry and "owing now" are capped at owing less pending,
  so a Renter is never debited twice for the same money. Late fees are
  ordinary charge lines with their own GST, added once.
- **Idempotency:** the retry has its own unique rule and Stripe key; emails
  have a notice row made before sending; late fees have a unique rule per
  rent charge; the run twice changes nothing.
- **Found and fixed while writing:** a retry made with the old direct
  debit after the Renter changed bank would fail or hit the wrong account,
  so a retry uses the active one; retrying a cancelled authority would
  breach the Direct Debit Request, so only waiting-may-help codes retry; a
  retry day that passed while suspended would otherwise fire on
  reactivation with stale amounts, so it is dropped; the holiday library's
  size would bloat phone downloads if imported from core's shared entry,
  so it is server-only; the name clash with `businessDayOf`.
- **Tenancy:** events matched by account (rule 3); the arrears list and
  dashboard query only the session's business (rule 1); new tables with
  forced row-level security; admin has no grant.
- **Edge cases:** a failure after the rental was returned (still emailed,
  no retry if nothing is owing); a Renter owing on two rentals (one row,
  both rentals); a Renter in credit (not listed); a reversed charge
  leaving the Owing list at once; a late fee for a week later credited
  after an early return (the late fee stays: the business can reverse it).
- **Scale:** the Owing list adds up every ledger line of the business on
  each visit. Fine for v1 sizes; measured with demo data in the tests, and
  moved into a database query if it slows.

## Not in this slice

- SMS to Renters (no provider yet).
- Collections, payment plans as their own feature, or reporting to credit
  agencies.
- Closing a rental with money owing (slice 7: it stays on the Owing list).
- Money totals on the dashboard beyond the Owing count (slice 8).
