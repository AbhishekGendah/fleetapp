# Review fixes, batch 1: rent in 24-hour blocks

Status: approved by Abhi on 4 Nov 2026 (rent from the handover time, not midnight).
From: docs/reviews/2026-11-04-full-code-review.md, and Abhi's direction on
4 Nov 2026: every car has a daily rate and a cheaper long-term rate, rent
is counted in 24-hour blocks from the handover, and a long-term rental
that ends below the minimum is re-priced at the daily rate (the business
can waive that). Must be right before Phase 4 slice 5 hangs bank debits
off the nightly run. Replaces Phase 4 decision 4 ("rate followed day by
day") and the weekday-based rent of slice 1.

## Why

Most serious review findings come from two things: rent counted in
calendar days on the business's clock (so a timezone change or a return
on rent day goes wrong), and weeks never looked at again once charged
(so returns, rate changes and waivers don't correct them). Blocks remove
the first; a correction step removes the second.

## How rent works after this

- **Every car has two prices** (car page, money boxes): a **daily rate**
  for short hires (required on every car from now on) and a **long-term
  weekly price** (optional; without one, long hires are 7 × the daily
  rate).
- **A rental copies its car's prices when booked**, and the business can
  change them for that Renter on the booking form (rule 14). After that,
  changing the car's prices affects new rentals only.
- **Rent is counted in 24-hour blocks from the exact handover time** (the
  Renter's signed acceptance, rule 15). Picked up Fri 27 Nov 10:00 and
  back Fri 4 Dec 10:00 is 7 blocks. Back by 11:00 is still 7 blocks
  within the grace period (Settings → Rentals, default 60 minutes); back at
  11:30 is 8.
- **Long-term or short hire is decided at booking**: ongoing rentals, and
  rentals booked for at least the minimum (Settings → Rentals, default 7
  days), are long-term. That is copied onto the rental.
- **Long-term: charged weekly in advance**, 7 blocks at the weekly price,
  each week starting at the handover time (Fri 10:00 every week). A block
  costs one-seventh of the weekly price, with the odd cents spread so 7
  blocks always add up to the weekly price exactly.
- **Short hire: the booked blocks are charged at handover**, at the daily
  rate. If the car is kept longer, each extra block is charged as it
  starts.
- **At the return**, the blocks actually used are counted and the rest is
  credited. If a long-term rental used fewer blocks than the minimum, all
  its blocks are re-priced at the daily rate, unless the business ticks
  **Waive the daily rate** on the return screen and gives a reason (logged).
- **Rate changes start at the beginning of a rent week**, so a week is
  never split between two rates. The change form offers the next week
  starts ("from Fri 4 Dec, 10:00"). It can't be signed once that start has
  passed, and a week that already has a signed rate can't be given
  another.
- **Corrections, not edits** (rule 11): every night, and straight after a
  handover, return or signed change, the app works out what each rent week
  should cost and adds a correcting line for any difference, with its
  invoice or adjustment note. Running it twice adds nothing.

## Review findings this fixes

- Rent after the car came back, same-day and after-hours returns, rent-day
  returns depending on the run (A4-1, A11-1, A11-4): blocks plus the
  return correction.
- Timezone change charging twice (A11-3, A1-2, A4-4): blocks are measured
  from the handover moment, so the business's timezone no longer affects
  amounts.
- Rate changes not applied, backdated, unsignable or compared with the
  wrong rate (A4-2, A11-2, A3-1, A6-8, A4-6, G2-5): rates change only at a
  week start, can't be signed late, one per week start, and compared with
  the rate for that week.
- A refund added on top of a waived week (A4-3): once anyone reverses a
  rent line for a week, the app stops correcting that week. Corrections
  carry the GST treatment of the line they correct.
- Taking back a credit makes no document; adjustment notes with the wrong
  title, GST or no description (A4-7, G8-1): every correction and credit
  reversal is invoiced or noted. Each line names what it corrects, follows
  the corrected document's title and GST, and reductions print as minus
  amounts.
- Cancelled booking strands its money (A4-5): its Money and Invoices cards
  stay, and a one-off charge waiting for the next weekly invoice is
  invoiced at once.
- The nightly run (G3-1, G2-1, G3-3, G3-7, G3-4, A4-10, part of G3-2): it
  only looks at rentals that can need work, so it no longer slows down
  every week. Each rental is handled on its own, locked while it's worked
  on, so a return or signature at the same moment can't be overwritten,
  and one failure doesn't stop the rest. Invoicing runs even if rent
  fails. Outside calls have time limits. The run stops cleanly before
  Vercel's 5-minute limit and carries on next night. AGS is emailed when
  anything fails or is cut short. Failed invoice emails are retried and
  shown as "Not emailed", with Email again.

## Decisions (push back on any)

1. **Grace period default 60 minutes**, editable in Settings → Rentals.
   Tradeoff: a return 59 minutes late is free; in return Renters aren't
   charged a day for a traffic jam.
2. **Long-term minimum default 7 days**, editable. Re-priced at the daily
   rate below it, waivable (approved by Abhi).
3. **Each Renter's rent week runs from their own handover time.** The
   "fixed rent day for everyone" and "part-week charging" settings go.
   Tradeoff: payments arrive on different days of the week; in return
   there are no part weeks and no odd first charges.
4. **Rate changes start at a rent week's start**, not mid-week. Tradeoff:
   a change waits up to 6 days; in return a week is never split and an
   invoice never needs re-pricing. Phase 4 decision 3 (30 days' notice for
   direct-debit Renters) is still to confirm with Stripe and lands in
   slice 5.
5. **Rentals booked before this change stop being charged by the run.**
   They are all test data on the dev site; their lines and invoices stay
   as they are. Settings → Demo data makes fresh ones. Production starts
   empty, so it never has old-style rentals. Tradeoff: Abhi's current test
   rentals freeze; in return there is only one rent engine, with no old
   buggy path kept alive.
6. **Cars without a daily rate** (all of today's test cars) show "Add a
   daily rate" on the car page, and the booking form asks for the rate
   until they have one.
7. **AGS alert email** comes from a new setting, `OPS_ALERT_EMAIL` (in
   `.env.example`, the Zod env schema and turbo.json; Abhi adds it in
   Vercel). Alerts carry counts and business IDs only, never Renter
   details (rule 7).

Left out on purpose: what suspension should do to rent and invoices
(G3-6, A9-4, A2-8). That needs Abhi's decision and gets its own small
plan. The other money items (A4-8, A4-9, A11-7, G4-1) come in the money
tidy-up after batch 2.

## How it is built (for the developer)

### Database (one migration, backwards compatible with the code before it)

- `vehicles`: `daily_rate_cents` and `long_term_weekly_cents`, nullable
  integers above zero.
- `rentals`: `rent_model` (`weekday` for rentals already there, `blocks`
  for new ones), `is_long_term`, `grace_minutes`, `long_term_minimum_days`,
  and `daily_rate_waived_reason`, all copied at booking (rule 14). The run
  skips `weekday` rentals (decision 5).
- `rental_rates`: `daily_rate_cents` beside the weekly price, and
  `applies_from_block` (the block number a rate starts at, always a week
  start for long-term rentals). Old rows keep their date.
- `ledger_lines`: `period_starts_at` and `period_ends_at` (timestamptz)
  for block-based rent lines, and `is_correction`. One original charge per
  rental and period start (unique index), any number of corrections. A
  new insert-time trigger refuses an original rent charge that overlaps
  another of the same rental. It's a trigger, not an exclusion constraint,
  so old dev rows aren't re-checked.
- Old columns stay (expand, then contract later): `charge_weekday`, and
  `period_start`/`period_end` dates on old lines.

### Core (pure, fully unit tested)

- Blocks: count used blocks from handover and return times with the grace
  period (at least one block).
- Rent weeks for long-term rentals; the booked span and extra blocks for
  short hires.
- What each period should cost: block shares of the weekly price, daily
  rates, and the re-pricing below the minimum unless waived.
- Corrections: standing original plus corrections against what is owed,
  per period. A period with any reversed rent line is left alone. GST
  follows the original's treatment.
- Rate-change rules: only at a week start, one per start, not signable
  after its start, compared with the rate for that week.

### Server and screens

- The car form: daily rate (required) and long-term weekly price (money
  boxes, rule 31); the car page warning.
- The booking form: prices filled from the car and editable; it says
  whether the rental is long-term or a short hire and why.
- Settings → Rentals: grace period and long-term minimum (digits only,
  length-capped); the two retired settings removed.
- Return screen: blocks used, the re-pricing line, and Waive the daily
  rate with a reason.
- Changes card: the week-start choice; refusals in plain words; the
  Renter's "start has passed" page.
- Contract templates: new fields (daily rate, long-term weekly price,
  minimum, grace period, the re-pricing rule). The default contract text
  states them, and the Change of terms template gets the week start.
- Rent run: per rental, its own transaction, rental row locked, rates and
  lines read again, missing originals and corrections added. The same code
  runs after a handover, return or signed change. It only looks at rentals
  out now, returned within the lookback, or changed since the last run.
- Billing: corrections and credit reversals in the pending documents;
  adjustment-note wording and minus amounts; held one-offs on cancelled or
  closed rentals invoiced at once; failed emails retried.
- Cron route: each part guarded, a time budget, timeouts, the alert.
- Demo data: cars get prices; rentals use blocks, with one long-term
  early return re-priced and one waived.

### Tests (CLAUDE.md requires them for money and timezones)

- Core: block counting at the grace edge, across both daylight-saving
  changes and in Perth, Sydney, Adelaide and Lord Howe (amounts must not
  depend on the zone). Long-term weeks, short hires, extra blocks,
  re-pricing and waiver, rate changes at week starts, waived weeks, GST on
  corrections, running twice.
- Database: the new columns' checks, the overlap trigger, and Operator B
  unable to read Operator A's rates or correction lines.
- Server: a run racing a return and a signature (two connections), one
  rental failing while others carry on, the cron guards and alert, credit
  reversal documents, cancelled-booking money, old-style rentals skipped.
- Browser: the car form, booking form, return screen with waiver, Changes
  card, the Renter's signing page and Settings → Rentals, at phone width,
  with the keyboard, axe and the download budgets.

### Legal (to docs/legal-notes.md)

- The 24-hour block, grace period and re-pricing rule must be in the
  contract the Renter signs (consumer law: clear, agreed price terms; a
  re-price the Renter didn't agree to would be unfair). The default
  template states them, and the business can't remove those fields from
  the template while the rule applies.
- Correction documents keep the GST records complete (tax invoices and
  adjustment notes for every change to invoiced rent).
- Decision 3's 30-day notice is still to confirm with Stripe before slice 5.

### Test checklist rows

- New rows: car daily and long-term prices, booking prices, grace period
  and minimum settings, the return screen's blocks and waiver, week-start
  rate changes, the "start has passed" page, cancelled rental money cards,
  Not emailed and Email again, the AGS alert.
- Changed rows (set back to "Not tested"): car form, booking form,
  Settings → Rentals, Money, Invoices and Changes cards, Renter signing
  page, contract templates, the nightly run.

## As built (4 Nov 2026)

- **Waive the daily rate** is on the rental's Money card, shown once a
  returned long-term rental has been re-priced, not on the return checklist:
  the checklist works offline and is signed on the spot, and the business
  can decide after seeing the corrected charge. It asks for a reason (kept
  for the business only) and credits the difference with its adjustment note.
- **Rate changes** are for long-term rentals only (a short hire is paid up
  front). The form offers the next eight rent weeks.
- **Moved to the money tidy-up after batch 2:** retrying invoice emails that
  failed, with "Not emailed" and Email again on the Invoices card (A4-10's
  email part, and part of G3-2). It needs a record of whether each email
  went, so it gets its own small plan.
- **Still to do in batch 1:** the contract fields for the block terms (daily
  rate, long-term price, minimum, grace period, the re-pricing rule) and the
  default contract wording.

## Senior review of this plan

- Tenancy: the run still goes one business at a time in its own context
  (rule 3); the lock is per rental inside it. New columns sit on tables
  that already have forced row-level security, and the admin app has no
  access to them.
- Money: integer cents, GST stored per line (rule 9). Corrections are new
  lines, never edits (rule 11), and numbering is untouched (rule 17).
  Re-runs add nothing, the unique index holds originals to one per period,
  and the overlap trigger backs it up (rule 20).
- Rule 14: prices, long-term status, grace and minimum are all copied at
  booking. Only a signed change of terms moves the rate.
- Rule 15: blocks start at the signed handover acceptance and end at the
  recorded return. A swap doesn't touch rent.
- Edge cases checked:
  - a return inside the grace period;
  - a handover before the planned start;
  - an overdue long-term rental (weeks keep coming);
  - an overdue short hire (blocks keep coming);
  - an end date moved later or earlier;
  - a reversal of a correction;
  - the run killed halfway (each rental is its own transaction, so
    nothing is left half done);
  - a rate change signed before the handover;
  - a car with no long-term price.
- Risk: the biggest change since slice 1, in the most sensitive code. The
  tests listed are the guard. The money and dates parts get the deep
  review (two checkers per finding) before the slice is called done, under
  the new CLAUDE.md rule.
