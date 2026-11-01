# Phase 3 plan — Rentals

Status: approved (1 Nov 2026). Slices 1 (bookings), 2 (contract templates) and 3 (signing) built 1 Nov 2026; slice 4 next.
Design: docs/design/04 (rentals), 05 (contracts, signing, handovers), the
bond part of 06, the Renter-link part of 08, the dashboard part of 09.

Phase 3 lets an Operator rent a car to a Renter from start to finish:
book it, have the Renter sign the contract on their phone, hand the car
over with a photo checklist, change things during the rental, and take it
back. Money that moves through Stripe (direct debit, weekly charges,
invoices) is Phase 4; Phase 3 records everything Phase 4 will charge from.

Eight slices, each deployed and tested on the dev site before the next.
Every slice follows CLAUDE.md: libraries first (rule 32), browser tests,
accessibility checks and download budgets for every screen (rule 33),
tenancy tests, checklist rows, legal notes.

## What is in, and what waits

**In:** bookings (fixed-term and ongoing) with double bookings made
impossible by the database; the checks before a car is handed over;
contract templates and signed contracts (PDF, fingerprint, evidence);
handover and return checklists that keep working on poor signal;
possession records (who had which car when, for fines); car swaps,
extensions, early returns and other changes, each recorded; bonds
recorded as held; the car status "Rented"; a bookings calendar; the first
dashboard cards.

**Waits:**
- Direct debit set-up, card payments, bond payments by card or debit,
  weekly charges, invoices and the ledger: Phase 4 (Stripe). In Phase 3
  the Renter's signing steps end at the signature; Phase 4 adds "set up
  your direct debit" and "pay your bond" as the last steps.
- Damage charges: Phase 3 records damage and the insurance claim; the
  charge on the ledger arrives in Phase 4.
- SMS: the provider is not chosen. Codes and links go by email until it is
  (decision 3).
- Fines: Phase 6, but they will rely on the possession records built here.

## Slice 1 — Bookings

Goal: an Operator can book a car for a Renter, and the same car can never
be booked twice for overlapping times.

- **Rental record:** Renter, car, type (fixed-term or ongoing), planned
  start, planned end (none while ongoing), weekly rate (cents), bond amount
  (cents), charge day, status, the Operator's settings at the time it was
  created (rule 14, using the snapshot that already exists), notes.
- **Weekly rate history:** each rate has the date it applies from, so a
  later change never rewrites the past (rule 9; Phase 4 charges from it).
- **Statuses:** draft (being set up; car not held) → booked (car held) →
  active (contract and handover signed) → returned → closed; cancelled only
  from draft or booked. A status only ever moves along these steps; the
  database refuses anything else.
- **No double bookings (rule 18):** each rental holds its car through a
  "car hold" record (car, rental, from, to), and a database rule
  ("exclusion constraint") refuses two holds on one car that overlap. A
  separate hold record, rather than the rule on the rental itself, is what
  lets a car swap work: the old car's hold ends at the swap, the new car's
  starts. An ongoing rental's hold has no end, so it blocks the car until
  an end date is set. Holds run "from up to but not including to", so one
  rental can end exactly as the next begins. A draft holds nothing; a
  booking holds its planned dates; a return ends the hold at the actual
  return time; a cancellation removes the hold.
- **Overdue meets the next booking:** if a car is overdue and its next
  booking is due to start, the next booking is flagged at risk (dashboard
  and both rentals), because the database cannot know the car is late.
- **Checks before booking and again before handover** (from Phase 2's
  waiting list): Renter not marked "do not rent", details and licence
  complete, licence not expired by the planned start (and warned if it
  expires during the rental), licence class allows a car, provisional
  licence allowed or not (setting), minimum age (setting, 21 to start
  with), licence scans held, car not sold, written off or off road.
  Booking with a warning is allowed and logged; the handover is blocked
  until hard checks pass.
- **Screens:** Rentals list (shared list: search by Renter or rego;
  filter by status; overdue and starting-soon badges), New rental form
  (Renter and car pickers, dates with a proper date picker, rate and bond
  with the money box), rental page (summary, timeline of what happened,
  Log tab). A Rentals tab on each car and each Renter.
- **Calendar:** a month and week calendar of bookings, filterable by car,
  using FullCalendar's free (MIT) views (decision 1).
- **New libraries:** React Aria Components (date and date-range pickers;
  Adobe; Apache-2.0) and FullCalendar (MIT parts only).

## Slice 2 — Contract templates and issued documents

Goal: an Operator writes their contract once, and every signed copy is a
fixed, provable document.

- **Templates:** the Operator writes their contract in an editor with
  headings, bold, lists and "insert field" buttons for merge fields (Renter
  details, car, dates, weekly rate, bond, charge day, notice period,
  insurance excess, fine admin fee, business details). Several templates
  allowed; editing makes a new version, and anything already signed keeps
  the version it used. The swap form and the change-of-terms form are
  templates too. Editor: TipTap (MIT core only; decision 2).
- **Starter template:** AGS supplies the layout and section headings with
  "write your terms here" notes, not legal wording (design 05), plus a
  clear note to have it checked by a lawyer.
- **Issued documents (rule 12):** a document table: kind (contract,
  handover report, return report, swap form, change of terms), the rental,
  the template version, the PDF file and its SHA-256 fingerprint. The
  database refuses any change to an issued document; a correction is a
  new version.
- **PDFs:** @react-pdf/renderer (MIT) turns the template, with its fields
  filled, into a PDF on the server, with the business's logo. Each PDF is
  stored once (rule 21) in general storage; nothing in it is an identity
  document.
- **Screens:** Settings → Contracts (list, editor with preview, versions);
  "Preview contract" on a rental.

## Slice 3 — Signing the contract on the Renter's phone

Goal: the Renter signs from a link, in a way that would stand up under the
Electronic Transactions Act.

- **New link purpose "sign contract"** on the existing Renter links
  (single-purpose, expiring, revocable, code on a new phone; rule 26).
  Sent by email (SMS later).
- **Steps:** code → confirm your details → read the contract (the full
  text, scrolled) → tick "I agree to sign electronically" → sign by drawing
  with a finger (signature_pad, MIT) or typing their name → done.
- **Evidence for each step (design 05):** time, that the code was right,
  internet address and browser. Kept with the document, never in the log
  text (rule 7). A certificate page is added to the PDF (who, when, how,
  the fingerprint of the contract they saw).
- **After signing:** the signed PDF is fixed and fingerprinted, emailed to
  the Renter and the Operator, and the rental shows "Contract signed".
  Signing an old version is impossible: if the template or the rental's
  terms changed after the link was sent, the link is cancelled and a new
  one sent.

## Slice 4 — Bonds (recorded, not yet collected through Stripe)

Goal: the Operator can see how much bond each rental needs and holds.

- **Bond account per rental** (design 06), as an append-only list of
  movements in cents: received (cash or bank transfer, with a reference,
  recorded by the Operator), later deducted or refunded (at close). Held =
  in minus out, always worked out from the list, never stored (rule 11's
  approach, ahead of the ledger).
- **"Bond required before handover"** (setting, on by default): the
  handover is blocked until the held amount reaches the bond amount, unless
  the Operator overrides with a reason (logged).
- Card and direct-debit bond payments, instalments and deductions for
  damage arrive with Stripe and the ledger in Phase 4. Bonds carry no GST
  (they are security, not payment, until used); recorded in the legal notes.

## Slice 5 — Handover

Goal: the Operator hands the car over on their phone, even with poor
signal, and the Renter accepts it there and then.

- **Checklist on the Operator's phone:** the photo list from Settings (8 to
  start with: front, rear, both sides, interior front and rear, dashboard
  with kilometres and fuel, boot; editable), odometer (adds an odometer
  reading), fuel level, existing damage marked on a car outline with a
  photo each, keys handed over, accessories.
- **Poor signal (rule 25):** the checklist saves itself on the phone as it
  goes (Dexie over the browser's own storage; Apache-2.0) and photos wait
  in a queue and send themselves when signal returns (Serwist, the
  standard offline toolkit for Next.js, with its Turbopack support; MIT).
  The page itself opens offline once visited. Photos are shrunk first, as
  today. What the phone keeps is only that handover's checklist and queued
  photos, and it is wiped from the phone once the handover is finished or
  cancelled, or after 7 days, so a shared or lost phone does not keep a
  Renter's details.
- **Renter's acceptance:** the Renter reads the summary on the Operator's
  phone and signs with their finger ("I received this car at this time,
  with these kilometres and fuel"; decision 4). Possession starts at that
  moment (rule 15).
- **Possession records:** car, rental, Renter, start, end. The database
  refuses two open or overlapping possessions of one car.
- **After acceptance:** the rental becomes active, the car's status becomes
  "Rented" (set only by the system), and the handover report PDF is fixed,
  fingerprinted and emailed.
- **The car outline:** a simple drawing of a car's top and sides that
  damage is tapped onto. Hand-built, with the reason in the plan: no
  maintained library does this; it is a picture with tap points.

## Slice 6 — Return

Goal: the car comes back with a checklist that shows what changed.

- **Same checklist, side by side** with the handover photos and damage;
  new damage highlighted. A new damage record holds the date, description,
  photos and an insurance claim (insurer, claim number, status, excess
  filled in from the policy).
- **Return time:** recorded by the Operator, including an after-hours
  return entered later with the real time. The Renter signs only if present
  (setting, optional by default).
- **After the return:** possession ends, the rental becomes returned, the
  car goes back to available (or to "off road" if the Operator says so),
  the return report PDF is fixed, fingerprinted and emailed. Closing (bond
  refunded or kept, balance settled) completes in Phase 4.

## Slice 7 — Changes during a rental

Goal: everything that changes mid-rental is a clear, signed where needed,
logged change.

- **Extend or end:** move the end date, turn a fixed-term rental into an
  ongoing one, or give an ongoing one an end date (the Renter's notice;
  notice period from the settings). Refused by the database if it would
  overlap another booking.
- **Overdue:** a fixed-term rental past its end without a return is flagged
  overdue (charges continue, in Phase 4).
- **Rate change:** recorded with the date it applies from, and the Renter
  signs a change-of-terms form. It cannot be set to apply before the
  notice that Stripe's direct debit rules require; that rule is confirmed
  with Stripe before Phase 4 charges from it (decision 5).
- **Car swap:** same rental; the Renter signs the swap form; a return
  report for the old car and a handover report for the new one; one
  possession closes and the next opens at the Renter's acceptance.
- **Early return:** a return before the planned end; the part-week setting
  (snapshotted) decides the last charge in Phase 4.
- **Cancel:** only from draft or booked; frees the car; logged with a reason.

## Slice 8 — Dashboard cards

The first cards of the dashboard (design 09), most urgent first: overdue
rentals, handovers and returns today and tomorrow, contracts waiting to be
signed, Renter details waiting for review (the decision from the code
review), licences expiring during a rental.

## Database (one migration per slice; tenancy and RLS on every table)

New tables: rentals, car_holds, rental_rates, rental_changes, contract_templates,
contract_template_versions, issued_documents, signing_evidence,
bond_movements, handovers (and their checklist items and damage marks),
returns, damage_records, possessions. Each has operator_id NOT NULL,
row security on and forced, the web role only (the admin login sees none
of it), and an isolation test. Append-only where the rules say so
(issued documents, signing evidence, bond movements, rental changes,
possession starts) with the same blocking triggers as the activity log.
The btree_gist extension is switched on for the two "no overlap" rules
(car holds and possessions; Neon supports it). Every create, change and
removal writes to the activity log with its actor (rule 19); the Renter's
signing and acceptance are logged as the Renter's link or the Operator's
User as they happen.

## Tests (required by CLAUDE.md, and more)

- Tenancy: Operator A cannot see or change Operator B's rentals,
  templates, documents, bonds, handovers or possessions.
- Double booking and overlapping possession refused by the database,
  including ongoing rentals, back-to-back bookings (one ends as the next
  starts, which is allowed) and a car swap (old hold ends, new one starts).
- Timezones: times entered on the Operator's clock, stored in UTC, around
  daylight-saving changes; the planned start and end stay right in Lord
  Howe and Adelaide.
- Money: rates and bonds in cents; bond held is always worked out from the
  movements; nothing stored as a balance.
- Documents: a fingerprint matches its PDF; an issued document cannot be
  changed; a signed contract keeps its template version.
- Status steps: only allowed moves happen; cancel only from draft or booked.
- Browser tests (rule 33) for every new screen, including the whole flow
  (book → sign on a phone → handover with photos while "offline" → return),
  accessibility checks and download budgets.

## Legal side (into docs/legal-notes.md)

- **Electronic signatures (Electronic Transactions Act 1999, s 10):** the
  method must identify the signer, show their intention, be reliable enough,
  and they must agree to sign electronically. The code, the explicit tick,
  the evidence trail and the fingerprinted PDF cover each part. Some
  documents still need wet ink; a rental agreement is not one of them, but
  the lawyer should confirm.
- **Unfair contract terms (Australian Consumer Law):** the contract is the
  Operator's; AGS supplies layout only. Penalties now apply for unfair terms
  in standard-form contracts, so the starter template tells Operators to
  have their terms checked.
- **Privacy:** signing evidence (internet address, browser) and handover
  photos are personal information: added to the privacy policy template and
  to "Download everything we hold". Their retention needs a decision with
  the lawyer (contracts are commonly kept 7 years; photos are set in Phase
  2's retention rules once rentals exist).
- **Record keeping:** issued documents are kept for at least as long as tax
  records (5 years) and never edited.

## Test checklist

Rows for every new screen, field and button, slice by slice, with the
phase "Phase 3".

## Decisions in this plan (pushed back on easily)

1. **Calendar: FullCalendar's free month and week views, not its paid
   timeline.** The "cars down the side, days across" timeline is a paid
   licence (from US$480). Tradeoff: no car-by-car timeline at first; the
   free views filtered by car, plus each car's Rentals tab, cover booking.
   The paid view can be added later without changing anything else.
2. **Contract editor: TipTap (rich text with a toolbar) rather than plain
   text.** Tradeoff: more work turning it into a PDF, but Operators get
   bold, headings and lists without learning any codes.
3. **Codes and signing links by email until an SMS provider is chosen.**
   Tradeoff: some Renters check email less often than texts. SMS slots in
   behind the same message interface later.
4. **The Renter accepts the car on the Operator's phone at pickup**, not on
   their own. Tradeoff: the Operator hands over their phone for a moment;
   in return there is no second link or code at the kerb, and acceptance
   happens exactly when the car changes hands.
5. **Rate changes are recorded and signed now, but only charged from in
   Phase 4,** after Stripe's notice rules for changing a direct debit are
   confirmed. Tradeoff: none until Phase 4, since nothing is charged yet.
6. **Bonds are recorded (cash or transfer) in Phase 3; collecting them by
   card or debit comes with Stripe.** Tradeoff: early testers record bonds
   by hand.
7. **Eight slices, contract signing before handover.** Tradeoff: the first
   full rental can only happen after slice 5, but each slice is usable and
   tested on its own.

Sources checked: [Neon btree_gist](https://neon.com/docs/extensions/btree_gist.md),
[FullCalendar pricing](https://fullcalendar.io/premium),
[Electronic Transactions Act overview (Attorney-General's Department)](https://www.ag.gov.au/node/6625).
