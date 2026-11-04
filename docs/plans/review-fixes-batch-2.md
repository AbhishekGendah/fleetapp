# Review fixes, batch 2: bond and direct debit (plan, awaiting approval)

From docs/reviews/2026-11-04-full-code-review.md, fix order item 2. Every
item here comes before Phase 4 slice 5 (weekly debits), because slice 5
takes money from the direct debit and counts on the bond records.

Design: docs/design/06-money.md. Earlier plan: docs/plans/phase-4.md
(slice 4). Touches money and Stripe, so nothing is built until this is
approved.

## What goes wrong today, and the fix

### 1. Bond paid twice by card (KS-1, serious)

Today every press of "Pay bond" opens a new Stripe page for the full
amount. Until Stripe's message arrives, the app doesn't know one was paid.
So a Renter coming back, or one with the emailed link and the QR code both
open, can pay twice.

Fix:
- **One open Stripe bond page per rental.** A new table,
  `stripe_checkouts`, records each Stripe page we open: its rental, what
  it's for, the amount, when it expires, and whether it is open, finished
  or expired. The database allows only one open bond page per rental.
- Pressing "Pay bond" again while one is open sends the Renter to the
  **same** Stripe page. Stripe lets a page be paid only once, so two
  phones can't both pay. If the amount owing has changed since (for
  example, cash was recorded), the old page is expired at Stripe first,
  then a new one is opened.
- **Stripe pages expire after 1 hour** (Stripe allows 30 minutes to 24
  hours; the default is 24 hours). A stale page from yesterday can't be
  paid.
- **Coming back from Stripe** ("finished"), the app asks Stripe at once
  what happened and records it. It doesn't wait for Stripe's message, so
  the page shows "paid" or "on its way" straight away and never shows the
  Pay button again.
- Until the result is known, a finished page counts as **on its way**,
  never as still to pay.

### 2. Bond taken again in cash while a bank debit is clearing (A5-2, serious)

Fix:
- The Bond card and the handover screen show **"$X on its way by bank
  debit (clears in up to 3 business days)"** next to what is held.
- **Recording a bond received by hand** is capped at what is still owing
  after money on its way. Over that, it says: "A bank debit of $X is on
  its way. If it bounces, you can record the bond then."
- **Recommendation:** at handover, money on its way does **not** count as
  held, because it can still bounce. The handover screen names it, and
  the business can go ahead with the existing "go without the full bond"
  reason. Tradeoff: one extra tap for the business on the rare day a car
  goes out while a bond debit clears, but no car leaves on money that
  might never arrive.

### 3. An older direct debit can replace the newer one (KS-2)

Today the last one Stripe tells us about wins, whatever its age.

Fix:
- Each direct debit stores **when the Renter set it up** (Stripe's
  creation time, new column `set_up_at`). The newest one set up is always
  the current one.
- When a newer one is recorded, every older one still waiting or active
  ends as "replaced". An older one that arrives late, or becomes active
  later, is recorded as replaced and never takes over.

### 4. A replaced direct debit stays live at Stripe (KS-3)

Stripe's way to cancel a direct debit from the business's side is to
detach the bank account from the Renter's Stripe customer. Stripe then
marks it inactive and tells us.

Fix:
- After a direct debit is replaced, the app detaches it at Stripe. This
  happens after saving, never while records are locked.
- New column `detached_at`. The nightly run retries any replaced one not
  yet detached, so a Stripe outage can't leave it live.

### 5. Stripe's "direct debit now active" message can be lost (KS-7)

If Stripe's message about a direct debit arrives before we have recorded
that direct debit, it is marked handled and thrown away.

Fix: a message about a direct debit we don't know yet is **not marked
handled**. The app answers "try again", and Stripe sends it again a few
minutes later. A test covers both orders of arrival.

### 6. A working account stuck on "Stripe needs more details" (A5-1)

Today anything Stripe lists counts, even something it will only want
later.

Fix: only items Stripe says are **due now or overdue** count
(`minimum_deadline.status` of `currently_due` or `past_due`). Items due
later show as a note on Settings → Payments ("Stripe will want more
details later: …"), but don't switch payments off.

### 7. Staff can "Correct" a bond that came through Stripe (A5-3)

Fix: a bond entry paid through Stripe has no Correct button. Its money
can only go back through Stripe (a refund in the Stripe dashboard), which
the app then records itself (item 8). The card says so.

### 8. Refunds and disputes in Stripe never reach the app (A5-4)

Fix: the app listens for Stripe's refund and dispute messages on the
connected accounts:
- A **refund** of a bond payment adds a "refunded" bond entry (the amount
  refunded, by card or bank), dated when Stripe made it. A refund that
  later fails is undone with a reversal.
- A **dispute** with funds withdrawn adds an entry for the amount taken,
  noted "Disputed with the bank". If the business wins and the funds are
  reinstated, a "received" entry puts it back.
- Each payment on the Stripe card shows "$X refunded" or "Disputed".
- Each entry stores the Stripe ID it came from (unique), so a repeated
  message changes nothing (rule 20).

### 9. A closed or disconnected Stripe account still shows Ready (A5-5)

Fix (this batch): the app listens for Stripe's "account closed" and
"disconnected" messages, and checks when it can't read the account. It
then marks the account **Disconnected**. Settings → Payments says so, and
Renters are no longer offered Stripe's page.

**Later, as its own small plan:** connecting a different Stripe account.
Renters' Stripe customers and direct debits belong to the old account, so
that change needs its own schema work.

### 10. Stripe keeps using a Renter's old email (A5-6)

Fix:
- When a Renter's name or email is saved and they have a Stripe customer,
  the app updates that customer at Stripe, after the save.
- A failed update is marked on the Renter's Stripe record
  (`needs_update`), and the nightly run tries again.
- Every Stripe page also sends the current name and email first.

### 11. The Stripe card disappears while Stripe re-checks, or once the rental closes (A5-7)

Fix: a rental's payment records always show, on the rental page and the
Renter's payments page, whatever the account's state or the rental's.
Only the buttons that start something new depend on them.

### 12. Bond arriving after a cancelled booking, and the dates on Stripe bonds (A5-8, A11-10)

Fix:
- A bond that lands on a cancelled booking is still recorded, because the
  money did arrive. The rental page then shows **"Bond to refund: $X"**,
  and the dashboard lists it until it has been refunded.
- Stripe bonds are dated by when Stripe says the money moved, in the
  business's timezone, not when the app happened to hear about it.

### 13. The "never sees" wording (KS-9, legal)

The payments page will say instead: "Your bank and card details go to
Stripe, the payment company {business} uses, which keeps them in
Australia and overseas. {business} can see only the last digits of your
account or card. Nobody can take money with what they see."

### 14. A dead QR code or link stays on screen (KS-6)

Fix: pressing "Send again" or "Set up on the spot" clears any earlier QR
code or copy box at once, and shows only the new one.

### 15. The smaller payments items (all from the review)

- **"Stripe is confirming" never goes away (KM-1):** it shows only while
  something is still on its way, and goes once it's settled.
- **Bond remainder under 50c (KM-2):** no Pay button for less than 50c.
  The Bond card tells the business to record or waive it.
- **Override reason demanded when not needed (KS-8):** handover checks the
  direct debit again as it saves. If one is now active, the reason isn't
  needed and nothing is logged as overridden.
- **Older rentals treated as needing a direct debit (KS-4):** rentals
  booked before that setting existed are marked not needing one. A
  migration sets this, and only for rentals whose settings snapshot
  predates the setting.
- **Payments email sent before the link is saved (KS-5):** the email goes
  only after the save. A failed send says so, as today.
- **One "can Renters pay through Stripe?" check (KL-3):** the copies are
  merged into one, used by the handover, the Stripe card and the Renter
  links.
- **One "remember this phone" step (KL-5):** the code written twice
  becomes one.
- **Payments email names the rental properly (KL-6):** make, model, rego
  and start date.
- **Two records without a history line (KL-7):** the Renter's Stripe
  customer and the "remembered phone" from signing are both logged.
- **Live site starting with test payment settings (A5-9):** on production,
  startup refuses a Stripe test key, or Stripe settings without the
  production flag.
- **Two buttons without the standard input check (A5-11):** both get their
  Zod check.
- **No limit on Stripe pages or licence photos per link (G6-6):** each
  link may open at most 10 Stripe pages and upload at most 20 licence
  photos an hour. Past that, it says "Too many tries. Wait a while, then
  try again." The counts are kept in the database, one row per link per
  hour.

## Database changes (migration 0043)

- New `stripe_checkouts` (tenant table, row-level security forced):
  operator_id, rental_id, link_id, purpose, amount_cents,
  stripe_checkout_session_id (unique), url, expires_at, status
  (open/complete/expired). Partial unique index: one open bond page per
  rental.
- `payment_mandates`: add `set_up_at` (filled from created_at for existing
  rows) and `detached_at`.
- `bond_movements`: add `stripe_object_id` (a refund or dispute ID).
  Unique together with kind. The rule "one entry per payment" applies to
  "received" entries only, so a payment can also have its refunds.
- `stripe_accounts`: add `disconnected_at`, plus `requirements_later`
  (the count of items due later, shown only).
- `renter_stripe_customers`: add `needs_update`.
- New `renter_link_attempts` (tenant table): link_id, hour, Stripe page
  count, licence photo count.
- Grants for the app login on the new columns. Nothing deleted, and no
  money rows changed.

## What Abhi does in Stripe (later, one step at a time)

The connected-accounts event destination needs the new message types
added: refunds, disputes and expired Checkout pages. The platform
destination needs "account closed". I'll give the exact clicks once the
code is in, one step at a time.

## Checked in Stripe's sandbox before building

These weren't settled by Stripe's docs, so each is tried in the sandbox
before relying on it, and anything different gets changed here first:
- Whether refunds and disputes arrive as thin events from the connected
  accounts' event destination.
- Which message a business disconnecting from the platform sends with
  Accounts v2 (`v2.core.account.closed` or the older "deauthorized" one).
- That detaching the bank account sends "mandate updated" with the
  direct debit inactive.

## Tests

- **Core:** money on its way vs held vs owing; the cap on cash recorded;
  the under-50c rule; which direct debit is current by set-up time; which
  requirements count.
- **Database:** one open bond page per rental; refund and dispute entries
  only once; isolation for the new tables (business A can't read B's).
- **Server:**
  - two Pay presses, or two phones, get one Stripe page;
  - a changed amount expires the old page;
  - coming back records at once;
  - both orders of the direct debit messages;
  - older replacing newer refused;
  - detach and its retry;
  - refund, failed refund, dispute lost and won;
  - account closed;
  - Renter email sync and its retry;
  - bond on a cancelled booking flagged;
  - Stripe date used;
  - link limits.
- **Browser:**
  - the payments page coming back from Stripe (no second Pay button);
  - "on its way" on the Bond card and the handover;
  - Send again clearing the QR;
  - the new wording;
  - with accessibility checks and phone width.

## Senior review of this plan

- **Tenancy:** new tables carry operator_id with forced row-level
  security. Stripe messages are still matched to their business only by
  account (rule 3). A refund or dispute is applied only to a payment of
  that business.
- **Money:** bond stays append-only, in integer cents. Refunds and
  disputes are new entries, never edits. Money on its way is never
  counted as held. Stripe is never called while rows are locked.
- **Repeats:** every Stripe object recorded once by its ID. The nightly
  retries (detach, email sync) are safe to run again.
- **Edge cases:**
  - a partial refund followed by another;
  - a refund larger than what is held (recorded as Stripe says; the card
    shows the shortfall);
  - a dispute on a bond already refunded;
  - a page expiring while the Renter is on it (Stripe refuses it, they
    come back and press Pay again).
- **Legal:**
  - the wording fix (consumer law, privacy);
  - bond refunds recorded (record keeping);
  - the bond-to-refund flag on cancelled bookings (consumer law);
  - Stripe's terms on cancelling direct debits from the business's side
    (detaching is Stripe's documented way).
