# Look slice 2, part B: "Overdue" in Needs attention

Status: approved by Abhi on 7 Nov 2026, including one shared "grace days"
setting (default 2) used here now and by Phase 4 slice 6's late fee later.

## What Abhi decided (6 Nov)

- A Renter who owes money shows in Needs attention. No "Owed to you" card.
- Paid by hand: overdue **2 days** after the charge was due (grace days,
  a setting).
- Paid by direct debit: overdue **as soon as a debit fails**.

## What it delivers

- **Needs attention line** per rental that is overdue: "**Sam Patel** ·
  $450.00 overdue · 9 days late", a red "Overdue" label. It is the most
  urgent kind, so it sorts first (oldest first). It opens the rental's Money
  tab; the name opens the Renter.
- **Settings → Payments: "Count as overdue after [2] days"** (digits only,
  0 to 30, default 2). It only decides what Needs attention shows; it never
  charges anything.

## How "overdue" is worked out (rule 11: from the ledger every time)

- For each rental not cancelled: its ledger lines go through the existing
  `owingCharges` (packages/core/src/ledger.ts), which pays off the oldest
  charges first.
- A rental is overdue when its **oldest owing charge** was due (its
  `effectiveOn`, the business's own calendar day) more than the grace days
  before today in the business's timezone. "Days late" counts from the due
  day. The amount shown is everything owing on that rental that is past its
  grace, not just the oldest charge.
- A new pure function in packages/core does this (`overdueOf(lines, today,
  graceDays)`), with unit tests: no charges; paid in full; part-paid;
  exactly on the last grace day (not overdue); the day after (overdue);
  reversed charges; a credit; a refund raising the balance; timezone edge
  at midnight.
- **Direct debits** do not exist yet (Phase 4 slice 5). When slice 5 adds
  them, a failed debit makes the rental overdue at once, and money still on
  its way by debit is not counted as overdue. This plan only reserves that:
  nothing about debits is built here.

## One setting, not two

The arrears plan (docs/plans/phase-4-slice-6.md) has its own late-fee
"after [3] days" of grace. Two grace settings that disagree would confuse
the business. Recommendation: **one** setting, "grace days", default 2,
used here now and by slice 6's late fee later (slice 6's plan is updated to
point at it and its default changes from 3 to 2). Unlike the late fee, which
is copied onto each rental (rule 14) because it charges money, Needs
attention reads today's setting, since it only shows things.

## Storage

Settings are a versioned JSON row per Operator (operator_settings), with
defaults and checks in packages/core/src/settings.ts. Adding the setting
needs **no database migration**: a new key with a default, checked with Zod
like the warning-days settings (rule 27), shown in Settings with the
existing number setting box.

## Tenancy and safety

- Loaded inside `withTenant` with the session's Operator only (rules 1 and
  2), one query for all rentals' lines, like the Rentals list's Owing column.
- Read only: no ledger line is written.
- Logged: changing the setting writes the activity log like other settings
  (rule 19).

## Tests

- Unit tests for `overdueOf` (above) and the setting's Zod check.
- A database test: two Operators, an overdue rental in each; each sees only
  its own (tenant isolation).
- Browser test: an overdue rental shows first in Needs attention on a
  phone and on a computer, with axe.

## Also proposed here (left out of part A)

Both are new money arithmetic, so they belong with this plan rather than
the screens:
- **Next rent on the rental strip:** the date and amount of the next rent
  charge, worked out by the same code the rent run uses (one way of
  calculating rent, never a second copy), with unit tests at block and
  period edges.
- **Charged / Paid / Owing totals on the Money tab:** summed from the
  ledger (rule 11), with reversals and corrections netted, integer cents,
  GST shown as stored on each line; unit tests including refunds and
  credits.

## Test sheet

New rows: the Overdue line, the setting.
