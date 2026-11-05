# Review fixes, batch 7: everything left from the review (plan, waiting for Abhi)

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
