# Review fixes, batch 5: privacy and records (approved 5 Nov 2026, 7-year retention)

From docs/reviews/2026-11-04-full-code-review.md, fix order item 5: before
the first real Renter. Touches the database, Renters' personal information
and what the app deletes, so nothing is built until this is approved. Every
item was checked against the code on 5 Nov 2026; all are real.

The rule for this batch: **every Renter is told what is collected and who
sees it, nothing personal lingers past its time, and "everything we hold"
really is everything.**

## A. Deleting what should be deleted

### 1. One retaken checklist photo stops the business's file clean-up for good (A1-1, serious)

Cause: a retaken photo is binned while the checklist is open. Thirty days
later the clean-up removes the file, then tries to mark it removed. The
database refuses, because that checklist is now finished. The same file
fails every night, and the business's other binned files (licence scans
included) are never removed.

Fix (migration 0046): the database lets the clean-up mark a photo removed
if it was binned while the checklist was still open. The photos the
finished checklist actually kept stay locked, as now.

### 2. One bad file stops a business's clean-up; the run has no time limit (A7-10)

Fix:
- Each file is cleaned up on its own. A file that fails is logged (never
  its details) and skipped, and the next file is done.
- A file that keeps failing doesn't hold up the rest: the oldest are done
  first and a failing one goes to the back.
- The whole nightly run gets a time limit (4 of its 5 minutes), like the
  rent run. Whatever isn't reached is done the next night.

### 3. Licence scans kept indefinitely once a Renter has had a car (G8-5)

Cause: a scan is kept while the Renter has any open rental, and "returned"
counts as open forever because nothing ever closes a rental.

Fix: only a booking or a car that is out keeps scans. A returned or
cancelled rental counts as ended at its return or cancellation, and a
draft never holds them. The setting then means what it says: deleted N
months (12 by default) after the Renter's last rental ended, or after the
scan was added.

### 4. Old Renter records are never removed (G8-4): **Abhi's decision**

Today nothing ever removes a Renter who stopped renting years ago.

Recommendation:
- Keep a Renter's rental and money records (rentals, invoices, payments,
  contracts, reports, signing records) for **7 years after their last
  rental ended**. That covers the tax office's 5 years and the 6 years a
  contract claim can be brought (WA and most states).
- After that, a nightly job removes the Renter's personal details:
  - name, contact details, date of birth, addresses, licence and
    emergency contact are wiped;
  - their signed PDFs and photos are deleted;
  - the money lines stay, as amounts only, so the business's books still
    add up.
- A Renter with a balance owing, an open fine or damage claim, or a
  rental not yet ended is never touched.
- Before launch, the lawyer confirms 7 years (launch checklist).

Tradeoff: 7 years keeps more than the tax minimum, but less risks losing
evidence the business needs in a dispute.

## B. Personal information that leaks

### 5. Small photos can keep the place they were taken (A7-9)

Cause: the photo shrinker hands back a small, well-compressed photo
untouched, with its location still in it.

Fix: every photo is always redrawn on the phone, so its hidden details
(location included) are always dropped. This covers car and checklist
photos, documents, licence scans and the licence photos Renters send.

### 6. Browsers keep copies of licence pictures on disk (A7-7)

Fix: licence pictures and other private papers are served with "never keep
a copy", so a shared office computer holds nothing once the short link
expires. Each view is already logged (rule 8).

### 7. Renter details stay on the handover phone (A6-4, A2-11)

Fix:
- **Cancelling a checklist**, or opening one that was finished on another
  phone, wipes that checklist from this phone.
- **Finishing one checklist** wipes only that one. Today it also wipes the
  saved pages of other checklists under way on the phone.
- **The 7-day limit** is checked whenever the app opens, not only when a
  checklist is opened again. It now covers the saved checklist pages too.
- **Signing out** wipes every checklist from the phone. If photos are still
  waiting to send, it says so first: "Send them now, or sign out and lose
  them".

### 8. A hiccup on the signing page can put the Renter's internet address in the logs (A3-10)

Fix:
- Recording "opened the contract" is caught if it fails. The log gets only
  the error type, and the Renter sees a calm "try again".
- After a right code, the code and its signing record are saved together,
  so a hiccup can no longer use up the code and then say it ran out.

### 9. "How to pay" bank details kept forever in the history; a few things not logged (A8-8)

Fix:
- **"How to pay" in the history:** a change records only "How to pay
  changed", never the bank details themselves.
- **Downloading the cars list** is logged, like the Renters list. It holds
  the names of Renters who have cars.
- **Built-in charge types** get a history entry when they are first made
  for a business.

Existing history lines can't be changed (rule 19); only test data has any.

### 10. The change-of-terms page shows the licence, date of birth and address needlessly (A3-9)

Fix: the "Check your details" box on a change form shows only what the
form uses: name, car, the change. The contract page keeps the full list.

## C. Telling the Renter

### 11. Privacy notices: missing or incomplete (G8-2, G8-3, A5-10, A3-11)

Fix:
- **One privacy notice,** used everywhere a Renter meets the app. It says:
  - who sees their details: the business, PintoFleet (the app), and the
    services it uses (Stripe for payments, Postmark for emails, Amazon for
    files, Google for address search), some of them overseas; plus the
    business's insurers, debt collectors and government agencies when the
    law or a claim needs it;
  - what the emails carry, including signed documents and photos;
  - the business's own contact details, and a link to its privacy policy.
- **Where it is shown:**
  - the Renter's details link;
  - the signing page, which also says their internet address, phone or
    browser and signature are kept for good as proof of signing;
  - the payments page, which also says their name and email go to Stripe;
  - the signing steps on the business's phone, as a short line with the
    link.
- **A Renter added at the counter** with an email is emailed the notice
  straight away. That is a service email, allowed under the Spam Act. The
  Add Renter page tells the business when it hasn't been sent (no email),
  so they hand the Renter a copy.
- **New setting:** "Your privacy policy (link)" in Settings → Business
  details (migration). Until it is filled in, the notice shows the
  business's contact details only.

### 12. The privacy policy template and AGS's overseas list are out of date (G8-6)

Fix: the template businesses copy
(docs/legal/renter-privacy-policy-template.md) is brought up to date with
what the app now does:
- the proof of signing kept for good, drawn or typed signatures, the
  direct-debit agreement and Stripe;
- what the emails carry;
- the real keeping times (the item 4 decision, and licence scans as in
  item 3).

AGS's own list of overseas services (docs/legal-notes.md) is updated:
Stripe, Postmark and Amazon S3 are live.

### 13. "Reply to this email" when replies can't reach the business (G7-4)

Fix:
- Emails sent while the business has no email in Business details never
  say "reply".
- Sending a Renter link, or finishing a handover, without a business
  email shows a warning that the business won't get replies or its own
  copies.
- Settings → Business details says why the email matters.

## D. "Download everything we hold" (A7-8, A3-5)

Today it leaves out most of what is held. Fix: it becomes a zip file
holding:
- **A workbook** with everything about the Renter:
  - their details, licence and notes;
  - their rentals and changes of terms;
  - their charges, payments and bond;
  - their invoices and receipts;
  - their direct-debit records (no bank numbers: Stripe holds those);
  - their signing records (when, internet address, device, typed name);
  - their links, damage records, the emails sent to them, and their full
    log.
- **The documents themselves:** every signed contract, change form,
  handover, return and swap report, invoice and receipt, and their licence
  scans.
- **Other people are left out:** staff names show as "the business".

The emergency contact the Renter gave is included (they supplied it).

Library: fflate (MIT), already installed through the PDF library, added as a
direct dependency, pinned (reason in the commit): Node has no zip maker.

## Database changes (migration 0046)

- The files trigger: lets the clean-up mark a photo removed if it was
  binned while its checklist was open (item 1).
- `operators.privacy_policy_url` (optional, a web address), and the
  business app may change it (item 11).
- For item 4 (if approved):
  - a narrow database function, run only by the nightly job, that removes
    one ended Renter's personal details;
  - deleting their issued PDFs, which otherwise can never be deleted
    (rule 13 allows only scheduled retention jobs to);
  - money lines stay, so balances stay right.

## Tests

- **Clean-up:**
  - retake, finish, then clean up after 30 days, including the small
    copies;
  - one bad file doesn't stop the rest;
  - the time limit;
  - licence scans removed after a returned rental, kept during a booking.
- **Retention:** a Renter past 7 years is removed; one with a balance, an
  open claim or a rental not ended is kept; the books still add up; a
  test proving the job never touches another business's Renters.
- **Privacy:**
  - a photo with a location comes out without it;
  - licence pictures are served with no-store;
  - the change page shows no licence, date of birth or address;
  - a signing-evidence failure logs no IP address;
  - "How to pay" never appears in the history.
- **Everything we hold:** each section present, the PDFs and scans
  inside, no staff names, nothing from another Renter or business.
- **Browser (phone width, keyboard, accessibility):**
  - the notice on the details, signing and payments pages and on the
    business's phone;
  - Add Renter's "notice not sent" message;
  - the privacy policy link setting;
  - sign-out with unsent photos;
  - a cancelled checklist wiped from the phone.

## Senior review of this plan

- **Privacy (APPs):**
  - APP 5: notice at collection, including at the counter;
  - APP 8: overseas services named;
  - APP 11: deleted when no longer needed; no copies left on shared
    computers or phones;
  - APP 12: "everything we hold" is complete.
- **Record keeping:** the money lines are never removed; the books still
  add up after a Renter's details are removed; the 7 years cover tax and
  claims.
- **Tenancy:** the retention job works one business at a time, scoped by
  its own data (rule 3); the new function is narrow and runs only as the
  job.
- **Immutability:** issued PDFs are deleted only by the scheduled retention
  job, never edited (rules 12 and 13).
- **Spam Act:** the privacy notice email is a service message (no
  marketing) and names the business.
- **Edge cases:** a Renter with no email; unsent photos at sign-out; a file
  that fails forever; a Renter with an old rental and a new booking.
- **Not in this batch:** database update safety (batch 6).

## Decision for Abhi

**How long a Renter's records are kept after their last rental ends.**
Recommendation: 7 years, then their personal details are removed
automatically (the money lines stay as amounts only), confirmed with the
lawyer before launch.

Tradeoff: longer than the tax minimum (5 years) but within the 6-year
window a contract claim can come; shorter means less held, but risks
losing evidence the business needs in a dispute.

## As built (5 Nov 2026)

- **A. Deleting what should be deleted:** migration 0046 lets the clean-up
  remove a photo binned while its checklist was open. Each file is cleaned
  up on its own, oldest first, a failing one sent to the back; the nightly
  run stops after 4 minutes. Licence scans are held only by a booking or a
  car out.
- **4. Seven years (migration 0047):** `renters.retired_at`, set only by
  `app.retire_renter`, which re-checks under lock (no booking or car out,
  seven years by the database's own clock, never sooner) and works only
  within the business set for the transaction. The job (lib/renters/
  renter-retirement.ts) also checks money either way, bond and open damage
  or claims (`isAnythingStillOpen` in packages/core). It removes the
  personal details, notes, submitted forms, link devices and emails,
  signing evidence, typed names and rental notes, and bins the Renter's
  files (licence scans, link photos, checklist and damage photos, issued
  PDFs); the usual clean-up removes them 30 days later. The files,
  checklist and signing-evidence protections each allow only that for a
  retired Renter. Owner policies (as in 0007): read of renters and rentals
  to find businesses with work; changes only within the current business.
  - Deliberately left: money lines (rule 11), including any free-text
    payment reference; invoices and numbers; the history; the business's
    own Stripe records. In legal-notes for the lawyer.
- **B. Leaks:** the shrinker always redraws (Compressor `strict: false`);
  every view link is "private, no-store" (links are signed afresh, so no
  caching was lost). Phone wipes: per-rental page cache, on the rental page
  for ended checklists, a week's limit on every signed-in page, and at
  sign-out with a warning (loaded only when needed; the phone database's
  code loads only where it exists, keeping every page in its budget).
  - Found on the way: billing documents opened through Next's link, which
    fetched every PDF ahead of time; now a plain link.
  - Found on the way: a damage photo chosen while its new mark was saving
    was lost (the mark left the phone's queue before the page showed it
    saved). Fixed with stable row keys; a browser test holds the save.
- **8–10.** Code evidence saved in the code check's transaction; the
  signing page catches a failed "opened" record. "How to pay" withheld in
  history; cars download logged (shared `recordListExport`); built-in
  charge types logged by the system; change forms show name, car, change
  and reason only.
- **C. Notice:** one wording in packages/core (`privacyNoticeFor`), on the
  three Renter link pages, a short line before signing on the business's
  phone, emailed after Add Renter (or the "Give them the privacy notice"
  card and a printable Privacy notice page). `operators.privacy_policy_url`
  (https on a real domain only). Renter emails never say "reply" without a
  business email; warnings by every link sender and on checklist pages.
  - Formatting (rule 31): the privacy policy link is a web address, kept
    as typed (a path can be case-sensitive), so no formatter applies.
- **D. Everything we hold:** a streamed zip (fflate 0.8.3, pinned): the
  workbook with every section, the issued documents and licence scans still
  held, and a files-not-included.txt if one can't be read. Streaming keeps
  memory low and avoids Vercel's 4.5 MB response limit.
