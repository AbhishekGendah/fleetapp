# Review fixes, batch 1: the rent engine

Status: waiting for Abhi's approval (money and schema: plan first).
From: docs/reviews/2026-11-04-full-code-review.md. Must be right before
Phase 4 slice 5 hangs bank debits off the nightly run.

## The root cause, in plain English

Rent is charged in advance, a week at a time. Once a week is charged, the
app never looks at it again. So anything that happens afterwards and should
change that week (the car comes back, a new rate is signed, the timezone is
corrected, the business waives the week) either does nothing or does the
wrong thing. Most of the serious findings are this one gap.

The fix: every night (and straight after a handover, return or signed rate
change), work out what each week **should** have cost, compare it with
what was actually charged, and add a correcting line for any difference.
Running it twice adds nothing, because the second run finds no difference.

## What changes for a business and a Renter

1. **Coming back on rent day costs nothing extra.** A rental booked
   Mon 2 Nov to Mon 30 Nov, returned on Mon 30 Nov, costs exactly 4 weeks.
   A week that starts on or after the return day is credited in full. This
   also covers a same-day return and an after-hours drop-off recorded the
   next morning. (A4-1, A11-1, A11-4)
2. **A new rate applies from its day, even inside a week already charged.**
   The difference for the days already billed is added (a rise) or
   credited (a cut), on that week's invoice line. An early-return refund is
   worked out from what was actually charged, never re-priced.
   (A4-2, A11-2, A3-1 part, A6-8 part)
3. **A rate change can't be signed once its start day has arrived.** The
   Renter's page says the start date has passed and to ask the business to
   send it again with a new date. The rental's Changes card shows the same.
   The signed form always matches what is charged. (A3-1, A6-8)
4. **A second rate change for a day that already has a signed rate is
   refused when it is proposed**, with a clear message, instead of failing
   every time the Renter signs. Every new rate is compared with the rate in
   force on its start day, not today's, so the form's "was" figure is right
   and the end of a temporary discount can be set up ahead.
   (A4-6, A6-8, A3-1, G2-5)
5. **Changing the business's timezone no longer moves any rental's dates.**
   Each rental keeps the timezone it was booked in. (A11-3, A1-2, A4-4)
6. **Waiving a week stays waived.** Once anyone reverses a rent line for a
   week, the app stops adjusting that week, so no unused-days refund is
   added on top of a waived week. Correction lines carry the same GST
   treatment as the line they correct, so they match the invoice. (A4-3)
7. **Every correction gets its document.** A credit becomes an adjustment
   note, an extra charge goes on a tax invoice, and taking back a credit
   (Reverse on a credit) now issues a tax invoice for it. Each line on an
   adjustment note says what it corrects ("Correction to Rent 2 Nov to
   8 Nov on INV-1004"), its title and GST follow the document it corrects,
   and reductions print as minus amounts. (A4-7, G8-1)
8. **A cancelled booking with money on it keeps its Money and Invoices
   cards**, so a payment can be refunded and a charge reversed. A one-off
   charge on it that is still waiting for "the next weekly invoice" is
   invoiced at once, because there will be no next one. (A4-5)
9. **The nightly run:**
   - only looks at weeks that could need work, so it no longer slows down
     every week (G3-1);
   - handles each rental on its own, locked while it is worked on, so a
     return or signature at the same moment can't be overwritten, and one
     bad rental doesn't hold up the rest (G2-1, A4-10 part);
   - invoicing still runs if the rent step fails (G3-3);
   - every outside call (file store, logo) has a time limit, and the run
     stops cleanly before Vercel's 5-minute cut-off and carries on next
     night with whatever is left (G3-7, G3-2 part);
   - when anything fails, is cut short, or an email can't be sent, AGS is
     emailed a summary (no Renter details in it) and the run reports
     failure (G3-4);
   - invoices and receipts whose email failed are retried the next night
     and shown as "Not emailed" on the rental's Invoices card, with Email
     again (A4-10).

## Decisions (push back on any)

1. **The return day is free when it starts a new week.** Inside a week,
   the return day still counts as used, as now. Tradeoff: a Renter
   returning on rent day pays nothing for that day. In return, an on-time
   return costs exactly what was booked, and the result never depends on
   whether the return was recorded before or after the nightly run.
2. **A rate change can't be signed after its start day** (no backdating).
   Tradeoff: a late Renter means the business resends with a new date. In
   return the signed form is always exactly what is charged. Phase 4
   decision 3 (30 days' notice for direct debit Renters) is not built yet;
   it moves into slice 5, where debits start.
3. **One signed rate per day.** A same-day correction has to be proposed
   from the next day. Tradeoff: one day at the signed rate. In return the
   rate history stays append-only and simple.
4. **Corrections are separate lines, never edits** (rule 11): one original
   charge per week (the existing database rule stays) plus any number of
   correction lines for that week.
5. **AGS alert email address** comes from a new setting,
   `OPS_ALERT_EMAIL` (in `.env.example`, the Zod env schema and
   turbo.json; Abhi adds it in Vercel). Tradeoff: one more setting. In
   return failures are never silent.

Left out on purpose: what suspension should do to rent and invoices
(G3-6, A9-4, A2-8). That needs Abhi's decision and gets its own small
plan. The other money items (A4-8, A4-9, A11-7, G4-1) come in the money
tidy-up after batch 2.

## How it is built (for the developer)

### Database (one migration, backwards compatible with the code before it)

- `rentals.time_zone text`: filled from `operators.timezone` for every
  existing rental, then filled by a trigger at insert when not given.
  The code reads it with a fallback to the business's timezone until the
  migration has run (code goes live before its migration, G1-3).
- `ledger_lines.is_correction boolean not null default false`. Existing
  rows need no change: existing period charges are originals, existing
  period credits are corrections by kind.
- `ledger_lines_one_rent_per_period` becomes "one original charge per
  period" (`kind = 'charge' and not is_correction`). Drop
  `ledger_lines_one_credit_per_period` (several corrections per period are
  allowed).
- New insert-time trigger: an original rent charge whose period overlaps
  another original rent charge of the same rental is refused. A trigger,
  not an exclusion constraint, so existing dev rows are not re-checked.
- `period_start`/`period_end` stay required on corrections, tying each
  correction to its week.

### Core (pure, fully unit tested)

- `rentOwedFor(period, rental)`: what a period should cost, given the
  handover and return dates in the rental's timezone, the rate history
  day by day, the part-week setting and decision 1.
- `rentCorrections(periods, chargedLines)`: per period, standing original
  plus corrections against what is owed. A period with any reversed rent
  line is left alone. Returns the lines to add, with GST from the
  original's treatment.
- Rate-change checks: refuse a date with a signed rate, compare against
  the rate on the start day, and the "start day has passed" rule for
  signing.

### Server

- The rent run per rental: its own transaction, `SELECT ... FOR UPDATE` on
  the rental, re-read the rates and lines, add the missing originals and
  corrections. The same function runs straight after a handover, return
  or signed rate change.
- Which rentals: out now, returned within the lookback, or changed since
  the last run (a new rate or reversal). No re-inserting of past weeks.
- Billing: correction lines and credit reversals in `pendingDocuments`,
  the adjustment-note line text and signs, held one-offs on cancelled or
  closed rentals invoiced at once, emails retried.
- Cron route: each part guarded, a time budget, timeouts, the alert.

### Tests (CLAUDE.md requires them for money)

- Core: every return case (mid-week, on rent day, same day, after hours,
  before the first charge), rate rise and cut mid-week, late and early
  signatures, waived weeks, GST on corrections, part-week settings, a
  timezone change, and running twice.
- Database: the new trigger and indexes, and that Operator B can't see
  Operator A's correction lines.
- Server: a run racing a return and a rate signature (two connections),
  one rental failing while others carry on, the cron route's guards and
  alert, credit reversal documents, cancelled-booking money.
- Browser: the cancelled rental's Money and Invoices cards, the "start day
  has passed" signing page, the refused second rate change; phone width,
  keyboard, axe, budgets.

### Legal (to docs/legal-notes.md)

- Return-day rule (decision 1) to say plainly in the contract templates.
- Correction documents: adjustment notes and invoices for every change to
  rent already invoiced (GST records stay complete).
- Decision 3 (30 days' notice) still to confirm with Stripe before slice 5.

### Test checklist rows

New rows for: return-day credit, rate correction lines, refused second
rate change, "start day has passed" signing page, cancelled rental money
cards, Not emailed and Email again, AGS alert email. Changed rows: the
rental Money card, Invoices card, Changes card, Renter signing page, and
the nightly run, each set back to "Not tested".

## Senior review of this plan

- Tenancy: the rent run still works one business at a time in its own
  context (rule 3); the new lock is per rental inside that context.
- Money: corrections are new lines, never edits (rule 11); GST is stored
  on each (rule 9); numbering is untouched (rule 17); re-runs add nothing
  because they compare against what is charged (rule 20), and the overlap
  trigger catches any future mistake at database level.
- Settings snapshot: the rental's own timezone is part of what a rental
  keeps from when it was booked (rule 14).
- Edge cases checked: ongoing and overdue rentals, a swap (no rent
  change), full-week part-week setting, a rate change before the
  handover, a reversal of a correction, the run killed half way (each
  rental is its own transaction, so nothing is half done), dev data from
  before the change (no updates to old lines needed).
- Risk: the first run after release corrects any already-wrong weeks on
  dev (fake data). It will add lines and documents for them; that is the
  intended clean-up, and nothing similar exists in production yet.
