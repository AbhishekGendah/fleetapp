# One-off charges: always told, then a notice period before any debit

Status: approved by Abhi on 12 Nov 2026, with a notice period of 3 days,
not 14; built 12 Nov 2026 (see "As built" at the end). Comes before Phase 4
slices 6 to 8.

## Why

Found while testing weekly debits in the Stripe sandbox (12 Nov). Today a
business can add a one-off charge (cleaning, damage, a fee) and debit it
from the Renter's bank the same day with "Take it now", or with the next
weekly debit. Nothing guarantees the Renter is told first:

- One-off charges go on the next weekly invoice by default
  (Settings → Invoices), so the invoice can arrive after the money is taken.
- The business can switch off automatic invoice emails, and can switch off
  Stripe's direct-debit emails in its own Stripe account.

Every charge is already a permanent, logged ledger line and a debit can
never be more than what is owing, but a dishonest business could take small
amounts with vague descriptions and the Renter might only notice on their
bank statement. Abhi's question: "what's preventing operators from silently
siphoning small amounts?"

What others do: Turo-style platforms run a claim with evidence and a reply
window before charging; Australia's BECS scheme expects the customer to be
notified at each debit, its guidelines suggest at least 14 days' notice
before a debit (not mandatory), and most direct debit agreements give 14
days' written notice of changes (Stripe's gives 30). See the sources at the
end.

## What changes (proposed)

1. **Every one-off charge gets its own tax invoice, emailed to the Renter
   at once, always.** The weekly-invoice batching option for one-off
   charges goes, and the "email invoices automatically" switch no longer
   covers one-off invoices (it still covers rent invoices). The email says
   what the charge is for, the amount and GST, the car, the business's
   contact details, and, if it will be debited, the date and the last four
   digits of the account. For a business Renter it goes to the business's
   contact, as other business invoices do.
2. **A notice period before a one-off charge can be debited.** A one-off
   charge is debited no earlier than its notice date: the day its invoice
   was emailed plus the notice period. "Take it now" becomes "Debit on
   [date]"; "With the next weekly debit" means the first weekly debit on or
   after the notice date; "Split" starts on or after it. "Invoice only,
   don't debit" stays the default.
3. **Notice period setting:** Settings → Payments, default 3 days (Abhi,
   12 Nov), the business can make it longer, never shorter than 3 (the
   lawyer to confirm; the BECS guidelines suggest 14, not mandatory, and
   Stripe's own pre-debit email goes the day before). Copied onto each rental when it is made (rule 14).
4. **No email, no debit.** If the invoice email could not be sent (no email
   address, or the send failed), the charge can't be debited until it has
   been sent (Email again); the screen says so.
5. **The Renter can query it.** The email invites the Renter to contact the
   business before the date. The business can still change the charge's
   plan to "Invoice only", reverse the charge, or pause debits, any time
   before the debit is made (as today). No automatic Renter "dispute"
   button in this slice (see Later).
6. **Weekly rent is unchanged.** The Renter agreed the amount in the signed
   contract, and rate rises already need a signed change and 30 days'
   notice.
7. **What the business sees:** on the charge, "Invoice emailed 12 Nov ·
   debit on 26 Nov" (or "Invoice not sent: email it before it can be
   debited"); on the Stripe card's debit list, one-off debits waiting for
   their date.

## Already-planned charges when this goes live

Charges already planned for debiting but not yet debited get their notice
date from when this goes live: their invoice is issued and emailed then if
it hasn't been, and the 3 days run from that email. Nothing already
debited changes. Only the dev site has any today.

## Schema (plan first; outline only)

- `debit_plans.notice_date` (date, Operator's timezone day the debit may
  first happen), set once when the charge's invoice email is recorded as
  sent; null until then. A plan with a null notice date is never debited.
- Rental settings snapshot gains `oneOffNoticeDays` (default 3).
- Settings: `oneOffChargeInvoicing` loses `with_next_rent` for new rentals;
  existing rentals keep their snapshot, but one-off charges on them are
  invoiced at once from go-live (an explicit, logged change for every open
  rental, rule 14, recorded once by the migration's follow-up job).
- The debit run's one-off selection adds `notice_date <= today`; the
  database refuses a debit item for a one-off part whose plan has no
  notice date or a future one (a trigger, so a code mistake can't skip it).

## Edge cases checked

- Charge added on a rental that is then returned: still invoiced at once;
  debited on its date while the direct debit is usable (as today).
- Charge reversed before its date: drops out (as today), and a credit note
  is emailed.
- Renter changes bank account before the date: the debit uses the new
  direct debit; no new notice (the amount and date haven't changed).
- Invoice email bounces after being sent: the notice date stands (we did
  send it); the bounce is shown on the invoice as today.
- Business Renter with several cars: one invoice per charge, to the
  business contact; debit per car as today.
- Clock: the notice date is a whole day in the Operator's timezone; the
  debit run already works in those days.

## Tests

Core: notice date maths across timezones and DST. Database: the trigger
refuses an early debit item; tenant isolation for the new column. Web: a
one-off charge always issues and emails its own invoice; "Debit on [date]"
debits nothing before the date and once on it; no email → no debit; the
settings minimum; already-planned charges at go-live. Browser: the charge
form's wording, the waiting debits list, keyboard and phone width, axe.

## Later (not in this slice)

- An AGS-side check flagging a business with unusually many one-off
  debits or disputes.
- A Renter "I dispute this charge" button on the emailed invoice that
  pauses that charge's debit until the business responds.
- Damage and excess as a Turo-style claim with photos attached to the
  invoice email (photos are condition-photos work).

## Legal

Add to docs/legal-notes.md: the lawyer to confirm the 3-day minimum and
the email wording against the BECS scheme rules, Stripe's DDR service
agreement and consumer law (unfair contract terms, unsolicited debits).

## Sources

- Stripe, Australia BECS Direct Debit payments:
  https://docs.stripe.com/payments/au-becs-debit
- Stripe, BECS Direct Debit Request Service Agreement:
  https://stripe.com/au-becs-dd-service-agreement/legal
- GoCardless, BECS notifications:
  https://gocardless.com/en-au/guides/becs-direct-debit/becs-notifications
- Turo, managing a damage claim (Australia guests):
  https://help.turo.com/en_us/managing-a-damage-claim-through-turo-australia-guests-Syf4kIkXel.md

## As built (12 Nov 2026; review fixes 13 Nov 2026)

Built as approved, with a 3-day notice period, then changed after two
reviews (13 Nov 2026) to the coordinator's principle on Abhi's standing
instruction: **the Renter must always have been emailed the actual terms of
every one-off debit (the date and how it is taken) at least the notice
period before it is made.** Migration 0064 (amended in place: it had not
been applied anywhere).

- **Core** (packages/core/src/one-off-notice.ts): the notice setting's
  limits (`DEFAULT_ONE_OFF_NOTICE_DAYS` 3, minimum 3, maximum 30, two digits
  in the box); the notice date (`oneOffNoticeDate`: the emailed moment's day
  on the business's calendar plus the notice, whole days); the window a
  notice covers (`noticeWindow`, `isWithinNotice`, `isNoticeLapsed`): from
  its date to `NOTICE_LAPSE_DAYS` (7) after the week the part falls in (a
  split's parts a week apart); and the words: "Debit on Sun 15 Nov", "With
  the first weekly debit on or after …", "Split over weekly debits, from …"
  (`debitPlanLabelOn`), the Renter's "It will be debited from your account
  ending 3456 on or after Sun 15 Nov 2026, and no later than Sun 22 Nov
  2026." (`chargeDebitNoticeText`), and the business's "Invoice emailed 12
  Nov · debit on 15 Nov" / "Invoice not sent: email it before it can be
  debited" / "… without a current debit date: email it again …"
  (`chargeNoticeStatusText`). `pendingDocuments` puts waiting rent (and any
  credit taken back) on one invoice and each one-off charge on its own. The
  settings key `oneOffChargeInvoicing` and its choice are gone (a stored
  copy that still has it is read without it); `oneOffNoticeDays` joins the
  settings, copied onto each rental (rule 14); older rentals read 3.
- **Database** (migration 0064). The design chosen for re-notices:
  - **`debit_notices`**, append-only (no update, delete or truncate), one
    row per notice the Renter was emailed: the plan and weeks it stated, its
    first debit day, the parts already debited when it was given, the
    invoice whose email stated it, and who gave it. Forced row-level
    security, web login only (rule 5).
  - **`debit_plans.notice_id`** points at the plan's current notice. Its key
    (notice, business, plan) means it can only point at a notice of its own
    plan. The plan trigger refuses a notice that doesn't state the plan's
    current plan and weeks, and **voids it (sets it to none) on any change
    of plan or weeks**, including to "Invoice only". So a changed plan is
    never debited on an old email: split 12 to own debit, split 12 to split
    2, and invoice only then back to a debit all need a new email.
  - **Recording a notice** (a trigger on `debit_notices`) refuses one that
    doesn't state the plan as it is or count its parts debited, or whose
    date is earlier than the day it is recorded (business timezone) plus the
    rental's notice days from its settings copy, never under the platform
    minimum of 3.
  - **A debit item for a one-off part** (a charge with no rent period) is
    refused unless the plan's current notice states the plan and covers the
    part and the debit's day (business timezone): from the notice's date to
    7 days after the part's week. The debit's request time may not be later
    than now, so the window can't be met by a debit dated ahead. (That check
    is on one-off parts only: rent parts are as before.)
  - `operators_with_debits_due` also names a business with a noticed
    one-off charge with parts left; the new
    `operators_with_charge_notices_due` names one with a charge planned for
    a debit, with parts left, not reversed, on an open rental, whose notice
    is missing, voided or lapsed. Owner read policies on plans, items and
    notices for these SECURITY DEFINER lookups (IDs only, rule 3).
- **The invoice email** (apps/web/src/lib/billing/charge-notices.ts): every
  billing document emailed from issuing or Email again goes through
  `emailBillingDocumentRecorded`, which records each try in
  `document_emails` (never the address, rule 7). An invoice with one-off
  charges (and a credit note taking one back) is always emailed, to the
  Renter or a business's contact, with the existing React Email template,
  which gained charge lines and a contact line: each charge, its amount and
  GST, the car, the business's phone and email, and, for a charge to be
  debited, the window and the account's last four digits (read from Stripe
  at send time, never stored). A notice that still covers the charge's next
  part is stated again as it was; otherwise the email gives a new date and,
  once it is recorded as sent, a new notice is recorded under the rental's
  lock then the plan's, only while the plan still has exactly the stated
  terms and no part was debited since; logged (`notice_given`, with the
  plan, weeks and date).
- **When no debit can be stated** (the business's Stripe account not ready
  or disconnected, no working direct debit or Stripe customer, or Stripe not
  answering for the digits), the invoice is sent without a debit line and
  gives no notice. It is never held back.
- **No email, no debit.** No address or a failed send leaves no notice. The
  charge's line says "Invoice not sent: email it before it can be debited"
  and offers **Email invoice again**.
- **The nightly notice run** (`runChargeNoticeCatchUp`, a part of the rent
  run after invoicing): for each charge planned for a debit with no current
  notice (never given, voided by a change, lapsed, or its email or Stripe
  read failed), once a debit could be made (business not suspended, Stripe
  ready, rental not paused and in a state its plan can be debited in, the
  Renter with an email, a working direct debit and a Stripe customer), it
  issues the invoice if needed and emails it with the debit, and the notice
  runs from that email. A charge with a current notice is never emailed by
  it, so it is safe to run again.
- **The debit run** takes a next-debit or split part, or reserves a "Debit
  on [date]" charge on its own as the system, only inside its current
  notice's window; never at once. **A notice lapses** if its part isn't
  debited within 7 days of its due day (a pause, Stripe not ready): nothing
  is taken on it, and the notice run emails a new date (today plus the
  rental's notice days) once a debit could be made. While paused, nothing is
  re-emailed.
- **Email wording: the window, not one day.** Every debit email states "on
  or after [date], and no later than [date + 7]" (split: "the first on or
  after … and no later than …, then one each week"), so whenever inside the
  window the run takes it, it is on the stated terms. Chosen over an exact
  date with the "on or after" form only inside the window, because the run
  can't promise the exact day (a pause, Stripe down, the 18:00 UTC run).
- **Changing a charge's plan** voids its notice (the database) and, if the
  new plan is a debit, re-emails the invoice at once with the new terms
  (`giveChargeNotice`); a change racing an email leaves no notice for the
  new terms, and the next email (or the run) gives one.
- **Email again** is logged as sent (rule 19) only when it went.
- **Screens**: the charge form and damage's Charge the Renter name each way
  with its first day and say "The invoice is emailed to them now, and
  nothing is debited before [date]"; changing a charge's plan says a change
  cancels the notice and the invoice is emailed again; each one-off
  charge's line says "Invoice emailed [date] · debit on [date]" (or the
  not-sent wording, with Email invoice again); the Stripe card lists one-off
  charges waiting for their debit; Settings → Payments has the notice box
  (digits only, checked as typed with the server's schema, rules 28 and
  31); Settings → Invoices loses the one-off choice. No new UI piece;
  download budgets unchanged.

### Second-round review fixes (13 Nov 2026)

- **Clock margin.** A one-off debit's request time may be up to 5 minutes
  ahead of the database's clock (`DEBIT_CLOCK_MARGIN_MINUTES`; 0064 checks
  `interval '5 minutes'`), as the app's server clock may run a little ahead.
  Beyond that a one-off part is refused.
- **A refused one-off part never takes the rent with it.** The week's debit
  is first reserved with its one-off parts inside a savepoint; if the
  database refuses it by a check (the notice rule, or a clock beyond the
  margin), only that savepoint is undone and the week's rent is reserved on
  its own. Each "Debit on [date]" charge is reserved in its own savepoint
  too, so one refusal drops only that charge.
- **No re-notice loop.**
  - A charge whose next part would take nothing (owing less pending debits
    leaves nothing, or under 50c: paid another way) is never emailed a
    debit by the run, and its line says "covered: nothing left owing to
    debit" with no Email again.
  - The run emails a plan at most `AUTOMATIC_NOTICE_LIMIT` (2) times
    (`debit_plans.automatic_notice_count`, counted before each send) since
    its last change of plan, its last notice or the business's last Email
    again. That covers a failed send and one retry, a send that couldn't
    state a debit and one retry, and the re-notice after a lapse (once per
    lapse, and only when a debit could be made then). After that its line
    says "Couldn't email the debit date: Email invoice again" and nothing
    more is sent by itself. A change of plan (the database) or the
    business's Email again starts the count again; a notice recorded resets
    it.
- **Told again partway through a split**: the email states the next part's
  own window (`noticeWindow`: the week it falls in, from the notice date a
  week per part), "the next on or after … and no later than …", not the
  first part's.
- **A send across midnight** keeps its date: each notice stores the email's
  send time (`debit_notices.emailed_at`) and its notice days count from the
  day it went, not the day it was recorded. The database accepts a send
  time only from the last hour (`NOTICE_SEND_WINDOW_MINUTES`) up to the
  clock margin ahead, so it can't be backdated.
- **Cast safety**: a missing or non-integer `oneOffNoticeDays` in a
  rental's settings copy reads as the platform minimum of 3.

### Go-live: how already-planned charges and open rentals switch

1. **Migration 0064** adds the table, the column and the rules, and writes
   one activity-log line per open rental whose settings copy held one-off
   charges for the next weekly invoice (rental changed,
   `oneOffChargeInvoicing` to `own_invoice`, actor the system; rule 14).
   Safe while the 0063 code serves: it writes no notices, its plan changes
   still pass, and any one-off part it tries to debit is refused (nothing
   sent to Stripe; that rental's run alerts AGS).
2. **The nightly notice run** then emails every already-planned charge's
   invoice with its debit the first night a debit could be made, and the 3
   days run from then. Invoices the 0063 code issued have no email records,
   so they show "Invoice not sent" until then and their Renters get a second
   email.

Departures, each for a reason:

1. **Notices are tied to the exact terms emailed** (review fixes): any
   change of plan voids the notice; invoice only gets none.
2. **The email states a 7-day window**, not one day (above).
3. **No debit stated when Stripe can't be used** (not ready, disconnected,
   no direct debit, Stripe not answering): the invoice still goes; the
   notice comes later from the run.
4. **Every billing email's try is recorded** (invoices, credit notes,
   receipts), as they share one path; statements unchanged.
5. **The maximum notice is 30 days**, so the box takes two digits.
6. **A one-off debit's Stripe description** stays "Charges 1BRT482, [day it
   was asked for]".
7. **Found and fixed while building**: the Money card counted every debit
   item of the business as a plan's parts debited, so once any charge was
   debited no plan could be changed on screen; a test keeps it fixed.
8. **No mockups**: only existing packages/ui pieces and the approved look.
9. **The failed-email path** is covered by the app's own tests, not the
   browser tests (their email always sends; on the launch checklist).
10. **Bounces**: the app records none yet, so a notice stands after a bounce
    (on the launch checklist).

Lock order rows in docs/plans/business-renters.md: recording a notice
(rental, the plan, then writes the notice) and the nightly run's "Debit on
[date]" charges (rental, then writes the payment and its items).
