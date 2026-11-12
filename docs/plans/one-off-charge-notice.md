# One-off charges: always told, then a notice period before any debit

Status: draft for Abhi's approval (12 Nov 2026). Touches money, so nothing is
built until he says go. Comes before Phase 4 slices 6 to 8.

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
3. **Notice period setting:** Settings → Payments, default 14 days, the
   business can make it longer, never shorter than 14 (to be confirmed with
   the lawyer). Copied onto each rental when it is made (rule 14).
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
it hasn't been, and the 14 days run from that email. Nothing already
debited changes. Only the dev site has any today.

## Schema (plan first; outline only)

- `debit_plans.notice_date` (date, Operator's timezone day the debit may
  first happen), set once when the charge's invoice email is recorded as
  sent; null until then. A plan with a null notice date is never debited.
- Rental settings snapshot gains `oneOffNoticeDays` (default 14).
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

Add to docs/legal-notes.md: the lawyer to confirm the 14-day minimum and
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
