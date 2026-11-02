# Phase 3 slice 6: the return

Status: plan for approval (2 Nov 2026). Design: docs/design/05 (return
report), 04 (statuses, possession), 06 (bond hold). Builds on slice 5: the
database already has the "return" checklist kind, the return report
document kind, the rental's returned time and the possession's end.

Goal: the car comes back with a checklist on the Operator's phone that
shows what changed since the handover, and everything that follows a
return happens in one step.

## Split in two

- **6a (this plan): the return itself.** Checklist, comparison with the
  handover, new damage marked, return time, the Renter's signature when
  present, and everything after.
- **6b (next): damage records and insurance claims.** Each new damage
  becomes a record (date, description, photos) that can carry an insurance
  claim (insurer, claim number, status, excess filled in from the car's
  policy), also usable for damage found later. Kept apart so 6a can be
  tested first; 6b needs a new table and its own screens.

## 6a: what the Operator sees

- **Rental page:** an active rental gets a Return card: Start return,
  Continue return, Cancel this return; once done, Returned at (time) and
  Open return report. The dashboard's overdue and returning-today lines
  already link to the rental.
- **Return checklist (phone first, same page as the handover's):**
  - The same photo list the handover used (not today's Settings, rule 14).
    Each slot shows the handover photo beside it, so the Operator matches
    the angle and sees the difference.
  - Kilometres (never below the handover reading; shows "driven N km"),
    fuel (with the handover's level beside it), keys returned,
    accessories, notes.
  - Damage: the handover's marks show on the outline, greyed and numbered,
    as already there. Marks added now are the new damage, in red, each
    with a photo.
  - Works on poor signal exactly as the handover does (saved on the
    phone, photos queued, page opens with no signal).
- **Return time:** now by default; the Operator can enter the real time
  for an after-hours drop-off (not before the handover, not in the future).
  The log shows who entered it and when they did.
- **Renter's signature:** if the Renter is there, they read what they
  accept ("I returned this car at this time, with these kilometres and
  fuel") and sign on the phone. If not, the Operator ticks "The Renter was
  not here" and the report says so. A new setting, "Renter must sign at
  the return", default off (docs/design/05).
- **Where the car goes next:** Available, or In service / Off road with a
  reason and expected-back date, chosen on the last step.

## 6a: what happens on Finish return (one transaction)

1. The checklist is completed and fixed (rule 12, as the handover).
2. Possession ends at the return time and points to this checklist
   (rule 15: fines are matched to it).
3. The rental becomes Returned with its returned time.
4. The car's booking hold is released from the return time, so an early
   return frees the car for new bookings.
5. The car's status is set as chosen; its kilometres are recorded as a
   "return" reading at the return time.
6. The return report PDF is made (both sets of photos side by side,
   kilometres driven, fuel then and now, new damage marked, signature or
   "Renter not present"), fingerprinted and kept, then emailed to the
   Renter and the business.
7. The bond card shows "Held until (return date + bond hold days)".
   Refunds and deductions are Phase 4 (closing).

## Build steps

- **6a.1 Core + DB:** return rules (gaps, kilometres driven, return time
  limits, acceptance text, "not present" wording), the new setting,
  migration 0034 (the inspection's return time, "Renter not present", and
  the next car status; grants), database tests including Operator A
  cannot see B's returns and a returned rental's possession is fixed.
- **6a.2 Server:** start, save, cancel, complete return; report PDF;
  emails; tests (early return frees the car; late return; after-hours
  time; signature or not present; status choice; overlap refused).
- **6a.3 Screens:** share the handover's checklist pieces between both
  checklists (no copy-paste, rule 30), the side-by-side photos, the greyed
  handover marks, the return-time box, the last step; Settings line.
- **6a.4 Demo data:** three returned rentals (one early, one late, one
  after hours) so the dashboard's idle cars and the return report have
  real examples.
- **6a.5 Verify:** browser tests at phone width including no signal,
  accessibility, download budget, checklist rows, legal notes, progress.

## Self-review

- **Tenancy:** every write in withTenant with the session's Operator; the
  possession end and return-checklist link are the only new possession
  changes the app's role may make (already granted in 0033).
- **Possession and fines:** end time can be entered for the past but never
  before the handover or in the future, and the database refuses an end
  before the start; the entered-later case is logged with who and when.
  Overlap with a later possession of the same car is impossible because
  that car's next possession cannot start until this one has ended.
- **Immutability:** the finished return, its marks and photos are fixed by
  the same triggers as the handover; the report is issued once.
- **Edge cases:** a rental returned twice (second refused by the unique
  "one completed return"); return started then a car swap (slice 7) —
  cancelled first; car sold while out (already refused while Rented);
  kilometres lower than the handover (refused, like the handover's check);
  return time before the handover (refused).
- **Money:** none moves. The bond hold date is worked out from the
  rental's own settings (rule 14), not today's.
- **Legal:** the Renter's acceptance at return is optional by design;
  the report records whether they signed. Noted in legal-notes.md with the
  handover acceptance question already on the lawyer list.
