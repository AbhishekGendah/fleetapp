# Full code review — 31 Oct 2026 (before Phase 3)

Five independent reviews (database; behind-the-scenes code; screens and
forms; money, dates, sign-in, emails, admin and build setup; the retention
slice). Each problem was checked against the real code, most of the serious
ones by actually running them. Duplicates are merged. Group A was fixed on
1 Nov 2026 (approved by Abhi), with migration 0025; group B the same day,
with migration 0026; group C the same day, with migration 0027.
Notes on how A was done: A1 locks a link after 10 wrong codes over its life
(no new column: the count is simply never reset); A7 refuses production on
the test inbox at start-up, and Renter emails stay visible in the dev test
inbox (dev holds fake data only); A8 uses a holding address plus the S3 ETag;
A13 never keeps the licence number (decision 2).

**Checked and found sound:** every table keeps each business's data apart
(row security on and forced everywhere), the admin login cannot see Renters
or cars, money maths is exact, timezone and daylight-saving conversion,
spreadsheet formula protection, file-type checks, random secrets and stored
fingerprints, breached-password check, email header escaping, every admin page
checks the Admin, no secrets reach the browser, error logs hold no personal
data. All 503 tests pass.

## A. Security and personal data (fix first) — DONE 1 Nov 2026

- **A0. Fixed already:** the Review button on the Details form card was
  missing (my part 4c change did not apply). Pushed.
- **A1. The 5-wrong-codes lock on Renter links can be dodged.** Asking for a
  new code resets the count, so someone with a forwarded link can make about
  12 guesses an hour for the link's whole life. Fix: count wrong codes over
  the link's life (e.g. lock at 10).
- **A2. Pasting a code on the link page sends old digits and uses up tries.**
  A blank or short code also counts as a wrong try, and enough of these lock
  the Renter out. Fix: send exactly what was pasted, and ignore codes that
  aren't 6 digits.
- **A3. Links keep working when they shouldn't:**
  - after the Operator approves (the form reopens and can be sent again);
  - after the Renter is archived;
  - after their email is corrected (codes still go to the old, maybe wrong,
    address);
  - when the business is suspended;
  - when the link is locked (Send back still emails "use your link").
    Fix: cancel the link in all these cases.
- **A4. The 5-wrong-passwords sign-in lock can be beaten by sending many
  guesses at once.** Proven: 29 guesses got through. The authenticator code
  still protects the account. Fix: count each attempt before checking the
  password.
- **A5. The clean-up's database function accepts any cut-off date.** If
  misused it would delete live submissions, and the "list businesses with
  work" functions would reveal which businesses hold data. Fix: the database
  works out the cut-off itself.
- **A6. The admin login can read every change written to the history,
  values included** (car regos, VINs, policy numbers). Today Renter details
  are withheld, but only because every line of code remembers to. Fix: let
  the admin login see only the who/what/when columns.
- **A7. The test inbox is the only way emails can be sent, nothing stops it
  being used in production, and Admins can read Renter emails there,
  including working links and codes.** Fix: refuse to start production with
  the test inbox, keep Renter emails out of the admin inbox, and take the code
  out of the email subject.
- **A8. A file can be swapped after it passes the content check** (the upload
  permission stays usable for 10 minutes). Fix: on confirm, copy the checked
  file to a final place that no upload permission covers.
- **A9. The confirm step doesn't check whose upload it is,** and two confirms
  at once can delete the file just confirmed (a licence photo shows "Added"
  but sending says it's missing). Fix: confirm only your own upload of the
  expected kind, and claim it in one step.
- **A10. A photo finishing after Send makes Send back fail every time.** Fix:
  refuse photos once sent, and clear any leftover before sending back.
- **A11. One Renter link can use up the whole app's daily Google address
  allowance:** choosing an address isn't counted, and bad searches use up the 50. Fix: count both, and check before counting.
- **A12. Pages can be shown inside another website** (a trick to make a
  signed-in person click buttons). Fix: one setting on both apps.
- **A13. The form saved on the Renter's phone holds their date of birth,
  address and licence number,** is written before they type anything, and
  can stay forever on a shared phone. Fix: save only what they type, leave out
  the licence number, and sweep old drafts on every visit.

## B. Things that break or mislead (fix next) — DONE 1 Nov 2026

- **B1. No error page:** if the connection drops while saving, the whole page
  turns into a blank error screen (for Renters too). Fix: friendly error pages
  ("check your signal; what you typed is kept").
- **B2. Upload buttons can stick on "Sending…" forever** after a dropped
  connection (Renter photos, scans, attachments, car photos, logo). Fix in one
  shared place.
- **B3. Retention slice bugs:**
  - the "Kept until about" date has no year (a date a year away reads as
    today);
  - submissions approved before yesterday can never be cleared (their scans
    still point at them);
  - a scan due on the 31st can wait up to 3 extra days;
  - the Log doesn't say why the System deleted a scan;
  - the "Deleted after N months" text uses today's setting, not the one used
    at the time;
  - nothing forces the rentals/fines check to be passed in later (it would
    quietly delete scans of Renters on a rental).
- **B4. "Download everything we hold" misses the licence photos a Renter sent
  through a link** and their history lines (privacy law, APP 12).
- **B5. Lowering the retention setting** quietly bins every older scan that
  night, with no warning. Fix: a confirmation that says how many scans will
  go.
- **B6. If the link email fails, the Operator is told nothing was sent, but
  the old link is already dead and the new one can't be copied.** Fix: still
  show the link to copy.
- **B7. The database connection has no handler for dropped connections**
  (Neon closes idle ones), which can crash a server instance. Fix: add a
  handler and an idle timeout.
- **B8. Database updates and the build setup:**
  - two updates pushed together fail if one adds a new option and the next
    uses it;
  - database updates run even when the tests fail;
  - the workflows have broader GitHub permissions than they need;
  - the build and format checks don't run in CI.
- **B9. The nightly clean-up has no batching or time limit,** and if one part
  fails the later parts don't run. Fix: run each part separately, in batches.
- **B10. Dates in spreadsheet downloads come out in UTC, not the business's
  time** (rule 10). Excel downloads also show a stray apostrophe on text
  starting with -, + or =.
- **B11. A time in the repeated hour when daylight saving ends moves an hour
  earlier if re-saved** (matters for fine times later).
- **B12. Saving one setting freezes all the other defaults,** so a later
  change to a default never reaches that business.
- **B13. The admin 8-hour sign-in limit isn't checked on the sign-in
  service's own pages.** Two first-Admin set-ups at once could both succeed.

## C. Rules, accessibility and tidy-up — DONE 1 Nov 2026

Notes on how C was done: the shared sign-in rate limit (C6) is put off to the
launch checklist (it needs a table and login-role grants; the database
lockouts already stop guessing). The "history can't pretend" rule covers the
admin app (Admin only) and the Operator sign-in (User or System only).

- **C1. Form rules 28 and 31:**
  - the Settings number boxes accept letters and don't jump to the error;
  - a few forms are missing the red asterisk or the "required" note (status
    forms, the code box, licence photos, document upload);
  - server refusals and hints aren't read out by screen readers.
- **C2. Phone and keyboard:**
  - some text links are smaller than the 44px touch size;
  - "Retake" works while a photo is still sending;
  - Tab in an address box replaces what was typed with Google's first
    suggestion;
  - filter dropdowns reload on every arrow key.
- **C3. Leftovers:**
  - unused imports in six files (turn on the checker that catches them);
  - two car-list columns both called "Rego";
  - "DoTDirect" (WA only) shown for every state;
  - some numbers typed into messages instead of using the shared settings;
  - policies can be archived but not restored.
- **C4. Repeated code** to merge:
  - the nightly "for each business" loop (three copies);
  - tab handling on car and Renter pages;
  - the photo slot send pattern;
  - a few repeated messages;
  - near-twin database helpers.
- **C5. Database hardening:**
  - stricter checks on what a Renter submission can hold (so approval can't
    fail late);
  - tie a submission's Renter to its link's Renter;
  - identity files must live in identity storage;
  - history can't be wiped with a bulk delete;
  - indexes for the nightly jobs;
  - history lines from the admin and sign-in logins can't pretend to be
    someone else;
  - a test that every new table's rule really is "own business only".
- **C6. Smaller:**
  - the browser downloads ~840 KB of server-only code on some admin pages;
  - no "server-only" markers on files holding secrets;
  - the health check answers OK even when the database is down;
  - the sign-in rate limit is per server;
  - example env files suggest the wrong database login for admin;
  - assorted wrong or stale comments, small speed-ups, accented car makes
    ("Škoda") not matching, next year's models refused before 10am on
    1 January.

## Decisions for Abhi

1. **A submission still waiting for review is deleted 30 days after its link
   ended,** with no notice to the Operator. Recommendation: keep it, but show
   "Waiting for review" on the dashboard (Phase 3) so nothing waits that long.
2. **The phone draft (A13):** recommendation, keep the draft but never the
   licence number.
3. **Anyone who knows a login's email can keep it locked out** with 5 wrong
   passwords every 15 minutes. Recommendation: accept for now (the lock is
   only 15 minutes), and add an alert in a later phase.
