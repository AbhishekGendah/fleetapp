# Review fixes, batch 7: everything left from the review (approved 5 Nov 2026)

From docs/reviews/2026-11-04-full-code-review.md, fix order item 7: the
remaining medium items, then the small ones. On 5 Nov 2026 every finding
not named in batches 1 to 6 (46 of them) was checked again against the
code. One is already fixed (A7-2, a late photo retake: batches 4 and 5).
The other 45 are listed here, grouped into slices. Some touch money,
Renter links or the database, so nothing is built until this is approved.

## A. Handovers and swaps (the serious ones first)

1. **A Do-not-rent Renter, or a sold or written-off car, can still be handed
   over (A6-1, serious).** Today only "handover" problems block; these are
   "booking" problems, so they are ignored and the car is set to Rented over
   Sold. Fix: one shared rule in packages/core, "what stops a handover", used
   by the page and the server alike, that includes them.
2. **The car being out already isn't checked (A6-3, serious).** An early
   handover, or a Renter overdue back, leaves the car looking free; the next
   handover then fails after the Renter has signed. Fix: an early handover
   moves the car's hold to start then (refused clearly if that clashes); a
   car still out on another rental is a handover problem shown before
   signing; a new booking on an overdue car gets a warning.
3. **Swap forms print the old car's details (G4-3, serious).** The VIN,
   rego and insurance excess on a swap form are the handed-back car's. Fix:
   swap forms are filled with the new car and the swap date; after a swap,
   change forms use the current car's excess. Invoices name the car for each
   charge from who had which car when (display only; no amounts change).
4. **Cancelling a booking leaves its checklist usable (A6-9).** Fix: cancelling
   the booking cancels its open checklist too, and finishing one on a
   cancelled booking says so plainly.
5. **A damage mark can be saved twice on patchy signal (A6-5, rest).** Fix
   (migration): each mark carries the phone's own key, and saving the same
   one again returns the first. A photo refused for good (e.g. wrong file
   type) is dropped from the phone's queue with a note, instead of blocking
   the checklist for ever.
6. **After a swap, the old car's damage can't be linked to the Renter who
   had it (A6-7).** Fix: a rental counts for a car if it is on it now or had
   it at some point (from the possession records), for damage and for the
   car's Rentals tab.
7. **"Cancel this handover" is one tap (A10-11).** Fix: a new shared
   "Are you sure?" piece in packages/ui (Base UI's alert dialog), used for
   cancelling a handover, return or swap, and for other one-tap removals
   below.
8. **"Save details" can stick on "Saving…" (A10-5).** Fix: a failed or hung
   save releases the button and says the details are kept on the phone.
9. **The return time in the repeated hour at the end of daylight saving is
   saved an hour early; Lord Howe's half-hour change is worded as an hour
   (A11-9).** Fix: the time "now" is kept exactly; a typed time in the
   repeated hour asks which one is meant; the warning names no amount.

## B. Cars and their records

10. **No warning for a car with no current insurance or rego (A8-2).** Fix:
    cover counts only from its start to its end date. The dashboard lists cars
    with none. At handover, missing insurance or rego stops it, unless a
    reason is typed, as for a short bond (migration: two reason columns on
    the checklist).
11. **A car or Renter can be archived while booked or out (A8-1).** Fix:
    refused with "finish or cancel its bookings first".
12. **A car can be sold during its handover (A8-4).** Fix: both lock the car;
    whichever comes second is refused clearly.
13. **A sold car can be switched back to Available in the Status box (A8-5).**
    Fix: Sold is set only by recording a sale and undone only by cancelling it.
14. **A purchase date in the future makes an old reading the "current"
    kilometres (A8-6).** Fix: refused; readings dated in the future never count
    as current (this also corrects what is saved already).
15. **An archived car's records can be removed from an old tab (A8-7).** Fix:
    every removal checks the car is still current.
16. **Damage photos behind a charge or claim, and a car's receipts and tax
    papers, go with one tap (A7-3, G8-7).** Fix: "Are you sure?" on every
    remove. Damage photos can't be removed while a charge or claim is open.
    Removed receipts and tax papers are kept 5 years, hidden but recoverable,
    before being deleted for good.
17. **"Removed photos can be brought back for 30 days" isn't true (A7-4).**
    Fix: a "Removed in the last 30 days" list with Bring back on the Photos
    and Documents tabs.
18. **Photos from rentals closed over a year never move to cheaper storage
    (rule 23, A7-4).** Fix: a nightly step moves them to S3 Glacier Instant
    Retrieval (same quick access, cheaper to keep).
19. **Leftover small copies of photos are never cleaned up (A7-5).** Fix: the
    photo is confirmed first and its small copy after; the clean-up removes
    small copies whose photo never arrived.
20. **Extra copies of an upload can be left in the upload holding area
    (A7-6).** Fix: a bucket rule removing anything left there after 2 days,
    on dev and production (Abhi, one step at a time).

## C. Money, invoices and settings

21. **The first settings save can lose a change made at the same moment
    (A8-3).** Fix: the settings row is made first, then locked, so both saves
    are kept.
22. **The next invoice number accepts "1e3" (A4-12).** Fix: digits and
    commas only; the numbering's first set-up is logged.
23. **An archived charge type can't be brought back (G4-4).** Fix: a "Bring
    back" button in Settings → Charges.
24. **The licence-scan clean-up's two look-ups don't name the business
    (G8-9).** Safe today (row-level security), but rule 1 says every query
    names it. Fix: they do.

## D. Renter links, codes and emails

25. **A failed code email still uses up one of the three codes, and the log
    says it was sent (G7-2).** Fix: if the email fails, the earlier code
    still works, the count isn't used, and the page says to try again.
26. **The code email always says "details form" (G7-3).** Fix: it says what
    the link is for (see decision).
27. **Link emails say "works until Friday" but the link stops earlier that
    day (A11-5).** Fix: the emails give the exact time.
28. **A payments link can be sent for an archived Renter, and the other
    links give the wrong reason (A3-13).** Fix: refused, with "This Renter is
    archived".
29. **"Sent back" is shown even when the email to the Renter failed
    (G7-5).** Fix: it says the email didn't go, and how long their link still
    works.
30. **The business's name is still worked out in four places (G7-9).** Fix:
    all use the one shared rule; a mistitled test is renamed.

## E. Dates

31. **"Short notice" can be flagged wrongly across a daylight-saving change
    or a time earlier in the day (A11-6).** Fix: notice is counted in the
    business's calendar days.
32. **The contract leaves out the insurance excess when the policy ends on
    the rental's first day (A11-8).** Fix: the policy's last day counts as
    covered, as everywhere else.

## F. Screens and accessibility

33. **Every screen has the same browser tab name (A10-2).** Fix: each page
    names itself ("Cars · …", the car's rego, the rental's reference); never
    a Renter's name (see decision).
34. **Box and signature outlines are too pale to see outdoors (A10-3,
    WCAG).** Fix: the box outline colour darkens to meet the 3:1 rule; cards
    are unchanged.
35. **The Renter's details form can't be filled in by the phone (A10-4).**
    Fix: the Renter's own name, phone, email and birthday can be auto-filled;
    the business's form is unchanged.
36. **The bottom tab bar can hide the box a keyboard user is on (A10-7,
    WCAG).** Fix: the page leaves room for the bar when moving focus.
37. **Confirmations in pop-ups ("Payment recorded") are never shown or read
    out (A10-8).** Fix: shown and read out beside the button once the pop-up
    closes.
38. **Required-field rules missed on a few forms (A10-10).** Fix: the bond
    and direct-debit reasons are checked as typed with the server's own rules;
    the "required" note and linked messages on the four forms missing them.
39. **Some messages aren't read out; some controls are hard to use
    (A10-12).** Fix: "Sent"/"Emailed" read out; the workshop bar's dates read;
    damage marks that can't be pressed are no longer buttons; chip remove
    crosses are 44px.

## G. AGS admin

40. **Car models: an archived car can be corrected; hiding twice logs twice;
    a rename leaves every car under the old spelling (A9-9).** Fix: archived
    cars refused (migration: the correction function); hide/show log only real
    changes; a rename offers "fix all N cars typed this way" (see decision).
41. **"Typed by Operators" sets its own timezone; a tampered request logs as
    an error (A9-10).** Fix: the shared admin timezone; requests checked with
    Zod.

## H. Browser tests and clean-up

42. **Screens never opened by the browser tests (A10-9, A9-6, KL-8).** Fix:
    keyboard, phone-width, accessibility and download checks for:
    - **business app:**
      - the Renter's submitted-details review, and the car and Renter edit
        pages;
      - the insurance policy pages, password reset, the suspended page and
        the privacy notice;
      - the damage page, the "Taking you back" page, and the remaining
        settings pages;
      - the Renter's details form, filled in and sent at phone width;
    - **admin app:** a business's page with Suspend and Reactivate, the car
      model pages, and the test inbox.

    Both test runners remove their sign-in files and results when done
    ("leave nothing behind").
43. Each slice adds its own browser and database tests (rule 33, and a test
    for every bug fixed).

## Database changes

- **Damage marks:** a phone key column, unique per checklist (item 5).
- **Checklists:** reasons for handing over without insurance or rego
  (item 10).
- **The car-model correction function:** refuses archived cars (item 40).
- **Files:**
  - removed receipts and tax papers kept 5 years before the clean-up removes
    them (item 16);
  - a record of which photos moved to cheaper storage (item 18).

All are additions that work with the code already live (batch 6's rule).

## Decisions for Abhi (my recommendation first)

1. **A new booking on a car that is overdue back:** warn when booking,
   block at handover. Tradeoff: the clash shows on the day, but the business
   can still plan ahead.
2. **No current insurance or rego at handover:** block, unless a reason is
   typed. Tradeoff: one extra step for a business not keeping insurance in
   the app.
3. **Damage photos while a charge or claim is open:** can't be removed.
   Tradeoff: a wrong photo stays until it's settled.
4. **Removed receipts and tax papers:** kept 5 years, hidden but
   recoverable. Tradeoff: a little more storage.
5. **Archiving a car or Renter:** blocked only by a booking or a car out
   (not by money owed). Tradeoff: an archived Renter may still owe money;
   it stays visible on the rental.
6. **The Status box:** "Sold" comes only from recording a sale. Tradeoff: a
   buyer must always be recorded.
7. **Invoices after a swap:** name the car on each charge. Tradeoff: a
   slightly busier invoice.
8. **Browser tab names:** a car's rego and a rental's reference, never a
   Renter's name. Tradeoff: tabs are less specific, but no Renter names
   end up in a shared computer's history.
9. **Notice:** counted in calendar days (end date minus today's date).
   Tradeoff: a 9am end on day 7 counts as full notice, though under 7×24
   hours.
10. **Link emails:** the exact time ("until 3:15 pm AEDT, Friday 13
    November"). Tradeoff: none worth noting.
11. **The repeated hour at a return:** the form asks which one is meant.
    Tradeoff: a rare extra question instead of a silent guess.
12. **The code email says what the link is for:** "fill in your details",
    "sign your rental contract", "sign the change to your rental", "set up
    your direct debit and bond".
13. **Car model renames (AGS):** a "fix all N cars typed this way" button.
    Tradeoff: one change touches many businesses' cars, logged per car.
14. **Darker box outlines:** about the colour of the muted text (slate).
    Tradeoff: a slightly heavier look, readable in sunlight.
15. **"Are you sure?" before cancelling a checklist:** wording "Cancel this
    handover? The photos and damage marks taken so far are thrown away."

## Senior review of this plan

- **Money:** no amount or ledger line changes. The invoice change is the
  car's name on each line only. Invoice numbering only gains a stricter
  box and a log line.
- **Tenancy:** every new query is scoped by the session's business; G8-9
  tightens two that relied on row-level security alone.
- **Renter links and codes:** G7-2 makes a failed email give back the code it
  used, never extra codes; the limit of three an hour stays.
- **Record keeping:** removals of evidence get a confirmation, a 30-day Bring
  back, and 5 years for tax papers; signed records are untouched.
- **Accessibility:** WCAG 2.2 AA items (outlines, focus under the tab bar,
  status messages) each get a browser test.
- **Size:** this is the largest batch. Slices A and B go first (they fix the
  serious items), then C to H; each slice is checked and pushed on its own.

## Not in this batch

Everything in the review is now in a batch. Anything new found while
building goes to the next one.

## As built: slices A, B and C (5 Nov 2026)

Slices A (handovers and swaps) and B (cars and their records), and the file
items of C, built together, as several files carry pieces of each.

- **1 (A6-1).** `handoverBlockers` in packages/core, used by the handover
  page and the server: Do not rent and a sold or written-off car now stop a
  handover. Under the transaction's locks the car must still be Available
  and the Renter still active, and only a booking still Booked is made
  active.
- **2 (A6-3).** New problems: `car_still_out` (a booking warns only when the
  other Renter is overdue back; the handover blocks whenever the car is
  out). An early handover moves the rental's hold to start then; a booking
  in the way is shown on the page before signing and refused cleanly at
  signing (also when the database's own rule catches a race).
- **3 (G4-3).** Swap forms are filled with the new car (`loadContractData`
  takes a car), and documents speak of the excess on the day: the start
  before the car goes, the day made once it is out. Ledger lines name the
  car the Renter had when the line's period began; invoices name the car on
  every line once a rental has had two (display only). The swap now locks
  its new car and refuses if it was sold, sent to the workshop or archived
  meanwhile.
- **4 (A6-9).** Cancelling a booking cancels its open checklist; a phone
  still on it is told "cancelled".
- **5 (A6-5).** Migration 0049: `inspection_damage_marks.client_key`, unique
  per checklist; a mark sent again returns the first. A photo the server
  will never take (wrong kind, too large, not a real photo) is dropped from
  the phone with a note instead of blocking the checklist.
- **6 (A6-7).** `isRentalOfCar`: a rental counts for every car the Renter
  had (possessions), for damage and the car's Rentals tab.
- **7 (A10-11).** `ConfirmButton` in packages/ui (Base UI AlertDialog, starts
  on the safe choice, in the component catalogue), for cancelling a
  handover, return or swap. `ActionButton` takes `confirm` for removals.
- **8 (A10-5).** Saving details gives the button back after 20 seconds or a
  failure, saying the details are kept on the phone.
- **9 (A11-9).** On the night the clocks go back the return form asks which
  of the two times was meant, pre-chosen for now; the "didn't happen"
  message names no amount.
- **10 (A8-2).** `isInsuredOn` / `isRegisteredOn`: cover counts from start
  to end date. The dashboard lists cars with none ("Missing"). At handover
  `no_insurance` / `no_rego` stop it unless a reason is typed (migration
  0048: two reason columns; never logged; blanked by the 7-year clean-up).
- **11 (A8-1).** Archiving a car or Renter booked or out is refused.
- **12 (A8-4).** A sale and a handover (or swap) lock the car, so the second
  sees the first.
- **13 (A8-5).** The Status box no longer offers Sold, and a sold car's
  status changes only by cancelling the sale.
- **14 (A8-6).** A purchase can't be dated after the business's today.
- **15 (A8-7).** Removing an archived car's rego, costs, readings, insurance
  links, photos or papers is refused.
- **16 (A7-3, G8-7).** Removing a photo, document or paper asks first. A
  damage photo can't be removed while a claim is open or a charge for it
  isn't reversed. Removed receipts and tax papers are kept 5 years.
- **17 (A7-4).** "Removed in the last 30 days" with Bring back on the Photos
  tab; removed documents and papers on the Documents tab.
- **18 (rule 23).** Migration 0050: `files.long_term_storage_at` and a
  look-up of businesses with photos due; the nightly run moves checklist
  photos of rentals back over a year to S3 Glacier Instant Retrieval.
- **19 (A7-5).** Checklist photos are confirmed before their small copy;
  the clean-up bins the small copy of a photo that never arrived.
- **A11-8.** The policy's end date counts as covered on contracts.

### Review (deep: two reviewers) and fixes

Fixed: the swap's new car was never re-checked; a cancelled booking could
be made active from an old open checklist; the early-handover clash only
showed after signing; a database clash in the hold move gave a raw error;
"finished" was shown for a cancelled checklist; the Renter wasn't re-checked
under the lock; "Missing" shown for cover that had expired; a reason needed
after the page loaded had no box (the message says to reload); the
repeated-hour choice was wrong for a time with seconds; a document made
before a late handover could change once the car went out; lines dated only
by day were named by entry time; three doc comments had moved; the confirm
pop-up's buttons read in a different order than they showed.

Left, noted: swaps don't check the new car's insurance or rego (a swap form
using the excess field says which field is missing); a dropped photo's note
is gone after a reload (a named photo shows "Not taken" again); the old
car's Rentals tab shows the rental's current car; small copies left on a
finished checklist stay (the database keeps those as they are); removed
policy papers have no Bring back yet (launch checklist); only the return
form asks about the repeated hour (bookings, changes and sales still take
the first).

## As built: slices D and E (5 Nov 2026)

- **21 (A8-3).** The first settings save makes the row (all defaults, version
  0) before locking it, so two first saves go one after the other; both kept.
- **22 (A4-12).** The next number takes digits and commas only; the
  numbering's first set-up is logged by the system.
- **23 (G4-4).** Settings → Charges lists archived types with Bring back.
- **24 (G8-9).** The licence-scan clean-up's look-ups name the business.
- **25 (G7-2).** A failed code email puts the link back as it was: the earlier
  code works, the hour's count is unused, the Log says no code was sent, and
  the page says to try again.
- **26 (G7-3).** The code email says what the link is for, in the four
  approved phrases.
- **27 (A11-5).** Link emails give the exact time ("3:15 pm AEDT, Friday 13
  November"), as does the sent-back email.
- **28 (A3-13).** No payments, contract or change link for an archived
  Renter; "This Renter is archived" is said.
- **29 (G7-5).** Sent back with the email failed says so, with how long the
  link still works, and the page stays.
- **30 (G7-9).** One rule for the business's name everywhere; the mistitled
  test renamed.
- **31 (A11-6).** Notice counted in the business's calendar days.
- **A8-9.** Renter search finds a phone typed without spaces or as +61.
- **33 (A10-2).** Every page names its tab; a car's by its rego, a rental's
  "Rental · rego"; never a Renter's name.
- **34 (A10-3).** Box, select and signature outlines darkened to slate
  (#64748b, over 3:1 on white).
- **35 (A10-4).** The Renter's own details form lets the phone fill in
  their name, phone, email and birthday.
- **36 (A10-7).** The page leaves room for the phone's tab bar when focus
  moves.
- **37 (A10-8).** A pop-up's confirmation is shown, and read out, beside its
  button once it closes.
- **38 (A10-10).** The required note on the handover details, the code step
  and the admin car fix; the car fix's messages linked to their boxes. (The
  handover's override reasons are said under their own boxes: slice A.)
- **39 (A10-12).** "Sent" and "Emailed" read out; workshop bars' dates read;
  marks that can't be pressed are not buttons; chip crosses pressed over
  44px.
- **40 (A9-9).** Migration 0051: an archived car is never corrected; hiding
  or showing twice logs once; "Fix all N cars typed this way", each car
  logged in its business's history and AGS's.
- **41 (A9-10).** The admin's shared timezone for "added" dates; bound
  arguments checked with Zod.
- **42 (A10-9, A9-6, KL-8).** Page checks (accessibility at desktop and phone
  width) for the rest of Settings, the timeline, the privacy notice, the
  insurance form and password reset (both ways it shows); a record-pages test
  (car and Renter edit pages at phone width, Stripe's return page, tab names,
  Bring back a charge type by keyboard); the admin's car models list and
  test inbox. Both runners remove their sign-in files, and their results
  after a pass.

Not reached in this batch, on the launch checklist: browser tests for the
Renter's submitted-details review, the insurance policy page, the damage
page on its own, the admin business page's Suspend and Reactivate, the
Renter's details form sent at phone width, and the "Account paused" page
(it needs a test login whose business is paused).

### Review (one quick pass each for D and E, links deeply) and fixes

- The "couldn't send" message no longer promises an earlier code still works
  (it may have run out).
- If the code email went but its Log line failed, the Renter is still told
  it was sent (otherwise they would ask again and get a second code).
  Tested.
- "Fix all" reads the spelling from the car itself, never the request, only
  touches cars not in the list, and skips cars that already read the new
  way, so nothing is logged for a change that isn't one (function renamed
  correct_vehicles_typed_like in 0051, not yet applied anywhere). Tested,
  plus an admin browser test that seeds two misspelt cars and fixes both by
  keyboard at phone width.
- A pop-up's closing message keeps its place for screen readers
  (`empty:sr-only`); "Add a document" now says "Document added." as it
  closes.
- The wrong-code message on the Renter's code step is linked to the code
  box; "Forgot password" names its tab.
- Outline buttons keep their light border (the darker one is for boxes).
- Chip rows sit far enough apart that a cross's press area never covers the
  next row.
- The signed-in User is read once per page, not twice (page plus tab title).
- The suspended page check was removed: it was really checking the
  dashboard. On the launch checklist instead.
- Both browser-test runners clean up from the app's own folder, and still
  clean up if stopping a server fails.
- Comments tidied (settings row, number box pattern, page descriptions).
- Launch checklist: once Postmark is in, tell a refused address apart from
  "unknown" for link codes, and give failed sends their own limit.
