# Phase 2 step 5 plan — Retention of licence scans and what Renters send

Status: draft for approval (31 Oct 2026). Detail for slice 5 of
docs/plans/phase-2.md (approved in outline: "12 months, a setting").

## What changes, in short

1. **Licence scans are deleted on a timer.** A scan goes to the 30-day bin
   12 months (a setting) after the later of:
   - when it was added, and
   - when the Renter's last rental ended (once rentals exist, Phase 3).

   Never while the Renter has a rental, fine or dispute still open (those
   come in later phases; the check is written now so they plug in). From the
   bin it is gone for good 30 days later, as for every deleted file (rule 23).
2. **What a Renter sent through a link is removed 30 days after their link
   ended, whatever happened to it** (approved, sent back or never reviewed).
   Today only never-approved ones are removed; approved ones would be kept
   forever with a second copy of the date of birth and licence number. Once
   approved, everything is on the Renter's record and the Log says who sent
   and approved it, so the copy is not needed.
3. **"Download everything we hold" includes what the Renter sent** that is
   still held (privacy law, APP 12): a "Sent through link" sheet.
4. **The licence number, name and other details stay** (they are needed for
   fines and tax records, which must be kept 5 years). Only the scans go.

## Why "the later of added and last rental"

Rentals do not exist yet, so "12 months after the last rental" alone would
keep every scan forever until Phase 3. Counting from when the scan was added
as well means:

- A Renter who never rents: scans go 12 months after they were added. If
  they come back, the Operator sends a details link and gets fresh photos.
- A regular Renter: each rental pushes the date out, so their scans stay
  while they keep renting, and go 12 months after the last one ends.
- A Renter on an open-ended rental: never deleted while it is open.

Archiving a Renter does not change the timer (archived Renters may still
have fines arriving).

## Screens

- **Settings → Renters:** "Delete licence scans this many months after the
  Renter's last rental, or after they were added" *, 12 to start with, 1 to
  60. Changing it applies at the next nightly clean-up (it is a data rule, not
  a rental term, so it is not snapshotted onto rentals).
- **Licence tab:** under the scans, "Kept until about (date), then deleted
  automatically (Settings → Renters)." Once deleted, the slot says "Deleted
  after (n) months, as set in Settings" and the Still needed card lists the
  scans again, so the Operator knows to ask for new ones before a rental.
- **Log:** "Licence scan deleted" by System, with the reason "kept the set
  number of months". Never what was in it.

## Database (one migration)

- `operator_settings`: a new column for the months (default 12, a check for
  1 to 60), like the other settings.
- A narrow database function telling the nightly job which Operators have a
  scan older than one month (the shortest setting): Operator IDs only, as the
  other clean-up functions do (rule 3). The job then works one Operator at a
  time with that Operator's own setting.
- Replace the submission clean-up function so it removes approved
  submissions too. Approving now unhooks the photos from the submission once
  they become scans, so the scans are never removed with it.
- The app still cannot delete any record (the schema guard test stays as it
  is): scans go to the bin, and submissions are removed only through the
  narrow function.

## Tests (required: retention and tenant isolation)

- A scan older than the setting is binned, a newer one is not; changing the
  setting changes which; a second run does nothing (rule 20).
- One Operator's setting never affects another's scans; Operator B's job
  never touches Operator A's files.
- The open-rental/fine/dispute check stops a deletion (tested with a stand-in
  until those exist).
- Approved, sent-back and never-reviewed submissions are all removed 30 days
  after the link ended; the scans made from an approved one stay.
- The download has the "Sent through link" sheet with what is held, and
  nothing once it is removed.

## Legal side (into docs/legal-notes.md)

- APP 11.2: personal information no longer needed must be destroyed or
  de-identified. This is that, for the most sensitive item (identity
  documents). The privacy policy template's "[X months]" becomes "12 months
  after your last rental (or after we received them, if you have not rented
  with us), unless a fine or dispute is still open".
- The Operator sets the period, so the template tells them to put in their
  own number if they change it.
- Handover and return photos (Phase 3) need their own retention decision with
  the lawyer; not part of this step.

## Test checklist

New rows for the setting, the "Kept until" line, the deleted slot and the
download sheet; the clean-up itself is covered by automatic tests (it takes a
year to happen by hand).

## Decisions in this plan (pushed back on easily)

1. **12 months from the later of "added" and "last rental ended".**
   Tradeoff: a Renter who has not rented for a year must send new photos,
   which the details link makes quick.
2. **All submissions removed 30 days after the link ended, approved ones
   included.** Tradeoff: no copy of exactly what the Renter typed is kept
   beyond that; the Log still shows that they sent it and who approved it.
3. **Settings range 1 to 60 months.** Tradeoff: an Operator could choose a
   very long period; 60 months matches the 5-year tax record period, so
   nothing legitimate needs longer.
