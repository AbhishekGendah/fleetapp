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

## As built (12 Nov 2026)

Built as approved, with a 3-day notice period. Migration 0064.

- **Core** (packages/core/src/one-off-notice.ts): the notice setting's
  limits (`DEFAULT_ONE_OFF_NOTICE_DAYS` 3, minimum 3, maximum 30, two digits
  in the box), the notice date (`oneOffNoticeDate`: the emailed moment's day
  on the business's calendar plus the notice, whole days, so daylight saving
  and late-evening emails never move it), `isNoticeDateReached`, and the
  words: "Debit on Sun 15 Nov", "With the first weekly debit on or after
  …", "Split over weekly debits, from …" (`debitPlanLabelOn`), the Renter's
  "It will be debited from your account ending 3456 on Sun 15 Nov 2026."
  (`chargeDebitNoticeText`) and the business's "Invoice emailed 12 Nov ·
  debit on 15 Nov" / "Invoice not sent: email it before it can be debited"
  (`chargeNoticeStatusText`). `pendingDocuments` (billing.ts) now puts
  waiting rent (and any credit taken back) on one invoice and each one-off
  charge on its own; nothing waits for the next weekly invoice. The
  settings key `oneOffChargeInvoicing` and its choice are gone; a stored
  document or rental copy that still has it is read without it.
  `oneOffNoticeDays` joins the settings, copied onto each rental (rule 14);
  rentals made before it read 3.
- **Database** (migration 0064): `debit_plans.notice_date` (date, none until
  set; the web login may update only it, besides 0063's columns); the plan
  trigger sets it once from none and never changes it, and allows setting
  it on a split already part debited while still refusing a new plan; the
  debit item trigger refuses a one-off part (a charge with no rent period)
  unless its plan's notice date is on or before the debit's day, worked out
  from the debit's request time in the business's timezone. Rent parts are
  checked as before. `operators_with_debits_due` also names a business with
  a noticed one-off charge with parts left (not suspended, Stripe ready);
  the new `operators_with_charge_notices_due` names a business with a
  charge planned for a debit and no notice date on an open rental (owner
  read policies on plans and items, IDs only, rule 3).
- **The invoice email** (apps/web/src/lib/billing/charge-notices.ts): every
  billing document emailed from issuing or Email again now goes through
  `emailBillingDocumentRecorded`, which records each try in
  `document_emails` (the existing document email records; never the
  address, rule 7). An invoice with one-off charges is always emailed,
  whatever "email automatically" says, to the Renter or a business's
  contact, with the existing billing-document React Email template, which
  gained the charge lines and a contact line: each charge, its amount and
  GST (or GST-free / no GST), the car (the template's rental summary), the
  business's phone and email, and, for a charge to be debited, the date and
  the account's last four digits. The digits are read from Stripe at send
  time (`readBankAccountEnding` on the payments interface; never stored,
  rule 7). Once the email is recorded as sent, each stated plan's notice
  date is set, under the rental's lock then the plan's, and logged
  (`notice_given`, the User or the system).
- **No email, no debit.** No address, a failed send, or Stripe unable to
  say which account (then nothing is sent at all, rather than a notice
  without the account) leaves the notice date empty. The charge's line on
  the Money card says "Invoice not sent: email it before it can be
  debited" and offers **Email invoice again**; the Invoices card's Email
  again does the same. Sent with the date: the notice date is set from that
  email.
- **The debit run**: Next weekly debit and Split take only parts whose
  notice date has come by the business's day; "Take it now" is now **Debit
  on [date]**: the nightly run reserves it on its own, as the system, on or
  after its date, on a booked, active or returned rental not paused (the
  same rentals the old Take it now allowed), never at once.
  `collectChargeNow` is gone.
- **Changing a charge's plan**: from invoice only to a debit, the invoice is
  emailed again at once with the date (`giveChargeNotice`); a notice
  already given stands (the Renter was told that date).
- **Screens**: the charge form and damage's Charge the Renter name each way
  with its first day and say "The invoice is emailed to them now, and
  nothing is debited before [date]"; each one-off charge's line on the
  Money card says "Invoice emailed [date] · debit on [date]" (or "Invoice
  emailed [date]" for invoice only, or "Invoice not sent …"); the Money
  card's debit notes name each waiting charge's day; the Stripe card's
  debit list shows each one-off charge waiting for its debit ("Waiting",
  with its day or "Not debited until its invoice is emailed"); Settings →
  Payments has "Days' notice before a one-off charge is debited" (the
  shared number box: digits only, two at most, checked as typed with the
  same Zod schema the server uses, rules 28 and 31); Settings → Invoices
  loses the one-off choice and says one-off charges are always invoiced on
  their own and emailed at once; "Invoice now" is gone from the rental's
  Invoices card (nothing waits). No new UI piece; the rental page's and
  Settings' download budgets are unchanged.

### Go-live: how already-planned charges and open rentals switch

The simplest mechanism that is safe while the 0063 code still serves:

1. **Migration 0064** adds the column and the rules, and writes one
   activity-log line per open rental (draft, booked, out or returned) whose
   settings copy held one-off charges for the next weekly invoice (or
   predates the choice, whose default was that): rental changed,
   `oneOffChargeInvoicing` from `with_next_rent` to `own_invoice`, actor the
   system, with the reason (rule 14: the copy itself never changes; the
   code no longer reads the key). In the minutes before the new code is
   live, the 0063 code still invoices as before and never writes a notice
   date; a one-off part it tries to debit is refused by the database (no
   debit made, nothing sent to Stripe; that rental's run alerts AGS), so
   nothing is debited without notice. Its weekly rent is debited by the
   new code's run, still inside the 7 days.
2. **The nightly rent run's new part, "one-off charge notices"**
   (`runChargeNoticeCatchUp`, after invoicing, before the debit run): for
   each charge planned for a debit with no notice date, not reversed, with
   parts left, on an open rental, it issues the invoice if there isn't one
   (which emails it) and emails the invoice of any whose email was never
   tried. So the already-planned charges are invoiced and emailed the first
   night (or at once, if the business presses Email invoice again), and the
   3 days run from then. Their invoices issued by the 0063 code had no email
   records, so they are treated as not emailed: the Renter gets the notice
   email even if the old code emailed that invoice before. A charge whose
   email was tried and failed is never resent by the run: the screen asks
   the business. Safe to run again.

Departures, each for a reason:

1. **A notice date is only given by an email that stated the debit.** The
   plan said "set when the charge's invoice email is recorded as sent". An
   invoice-only charge's email says nothing of a debit, so it gets no date;
   if the business later changes it to a debit, the invoice is emailed again
   with the date, and the notice runs from that email. Otherwise a charge
   could be debited on a date the Renter was never given. Changing between
   the debit plans after the notice keeps the date (the amount and the
   first day are unchanged; a split only takes it in smaller parts later).
2. **No working direct debit when the email goes** (cancelled since the
   charge was planned): the email states no debit and no date is given;
   Email invoice again once a new direct debit is set up gives one.
3. **Stripe unreachable for the last four digits**: nothing is sent and the
   try is recorded as failed, rather than an email without the account
   (the plan requires the digits). The business presses Email invoice
   again.
4. **Every billing email's try is now recorded** (invoices, credit notes,
   receipts), not only the one-off invoices', since they share one path;
   statements are unchanged. Email again on a billing document is now
   logged as sent by the User (rule 19), as on a rental's papers.
5. **The maximum notice is 30 days** (Stripe's own notice for a changed
   debit), so the box takes two digits. Not stated in the plan.
6. **A one-off debit's Stripe description** stays "Charges 1BRT482, [day it
   was asked for]", now the notice day.
7. **Found and fixed while building**: the Money card's count of a plan's
   parts already debited read every debit item of the business (a
   sub-query's column without its table name), so once any charge of the
   business was debited no plan could be changed on screen. Now each
   charge's own; a test keeps it so.
8. **No mockups**: the changed cards use only pieces already in
   packages/ui and the approved look (as slice 5). Abhi to look at the
   charge form, the Money and Stripe cards and Settings on the dev site.
9. **Browser tests** cover the charge form's wording, the line's "Invoice
   emailed · debit on", the waiting debit on the Stripe card, the notice
   setting and Settings → Invoices at phone width with axe; the failed-email
   path ("Invoice not sent", Email invoice again) is covered by the app's
   own tests only, as the browser tests' email always sends (on the launch
   checklist).

10. **An email that bounces after it was sent**: the plan's edge case says
    the bounce shows on the invoice "as today", but the app records no
    bounces yet (Postmark's bounce news isn't read). The notice date stands
    either way, as the plan says; showing bounces is on the launch
    checklist.

Lock order rows added to docs/plans/business-renters.md: recording an
invoice email's notice dates (rental, the plan) and the nightly run's
"Debit on [date]" charges (rental, then writes the payment and its items).

