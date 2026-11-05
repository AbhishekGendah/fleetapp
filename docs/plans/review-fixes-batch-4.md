# Review fixes, batch 4: signing and documents (approved 5 Nov 2026)

From docs/reviews/2026-11-04-full-code-review.md, fix order item 4. Touches
signed documents, the Renter links and the database, so nothing is built
until this is approved. Every item below was checked against the code on
5 Nov 2026; all are real.

Signed papers are the business's evidence in a dispute (damage, fines,
unpaid rent). The rule for this batch: **what the Renter signs is exactly
what they saw, exactly what is printed, and they get a copy (or the
business is told they didn't).**

## A. The signature itself

### 1. The Renter's signature keeps only the last stroke (A10-1, serious)

Cause: the signature box starts afresh every time the page redraws, and
the Renter's link page redraws after every stroke. The handover, return
and swap screens happen not to trigger it today.

Fix: inside the shared signature box (packages/ui), so it holds whatever
screen uses it: the drawing is made once and never reset by a redraw.
Strokes still survive turning the phone or resizing.

### 2. Signing on the business's phone offers drawing only (G9-10)

Fix: the handover, return and swap signing steps get the same "Draw" or
"Type your name" choice as the Renter's own link. A typed name must match
the Renter's name (the same check the link uses) and is printed on the
report in the signature style, with "Typed" beside it, as on contracts.
The method is recorded with the report. "Renter not here" at return stays.

### 3. Some accented names print wrongly (A3-4)

Today's PDFs use the built-in PDF fonts, which can't print letters such as
Ł, ő or ș: "Łukasz" prints as "Aukasz", even in the typed signature.

Fix: embed a font that covers every European alphabet (Latin, Greek,
Cyrillic) in every PDF: contracts, change forms, reports, invoices,
receipts. One place makes every PDF, so it is one change. No new code
library: the PDF library already embeds fonts.

**Abhi's decision (see the end).** Fonts with this coverage are almost all
under the SIL Open Font License, which isn't on the licence list in our
rules (rule 32 lists code licences only).

### 4. Photos can be silently left out of a signed report (G9-7)

Two causes: photos picked from some Android galleries stay in WebP, which
the PDF can't hold; and a photo that fails to load at that moment is
replaced by its name and "(photo kept with the rental)", with no warning.

Fix:
- The phone turns every car and checklist photo into JPEG when it shrinks
  it (it already does for camera shots). Logos stay PNG so their
  transparent background is kept; a WebP logo becomes PNG.
- The server accepts only JPEG or PNG for those photos (checked from the
  file itself, rule 22), so a WebP can't sneak in another way.
- A photo that can't be loaded when the report is made **stops the
  report**: the screen says "Couldn't add every photo to the report.
  Check your signal and try again." Nothing is signed or locked until
  every photo is in. Missing photos are never silently dropped.

## B. What the Renter is shown is what is signed

### 5. Kilometres, fuel or keys corrected but not saved (G9-2)

Fix:
- The signing step shows the Renter the kilometres, fuel and keys as they
  will be printed, read from what was saved, not from the boxes.
- While a detail is changed but not saved, the signing step is blocked
  with "Save the details first" beside the Save button.
- The sentence the Renter reads on the phone is made by the same function
  that writes it into the report (G9-11), so the two can't differ.

### 6. A last-second change on a second phone (A6-10) and a signature on the wrong swap (A6-11)

Today nothing ties the signature to the checklist the Renter saw.

Fix, the same for handover, return and swap:
- The signing screen sends a fingerprint of what it showed (details,
  damage marks, photos, the sentence) and which checklist(s) and swap it
  was for.
- Inside the locked save, the server works out the same fingerprint from
  the database. If anything differs, nothing is signed: "Something on the
  checklist changed. Check it again, then sign."
- The PDF is made from that same checked view, so the report matches the
  fingerprint.
- A photo can't be attached to a checklist once it is finished (today an
  upload that finishes late can be), checked in the database (migration).

### 7. Car swap: the Renter signs terms they were never shown (G9-1, serious)

Fix:
- The swap signing step shows the filled-in swap form in full (the
  business's own swap terms), as the contract signing page does, plus the
  new damage found on the car being handed back, and both cars'
  kilometres and fuel.
- The form version shown is the one printed. If the business edits the
  swap template in between, signing is refused with "The swap form
  changed. Check it again." (the same check contracts use).

### 8. The return report gives the return time as the signing time (G9-4)

Fix: "Signed on the business's phone at …" uses the moment of signing. The
return time stays in the sentence "I returned this car on …".

## C. Copies emailed, and reports that can be found

### 9. "A copy was emailed" when it may not have been (G7-1, G9-9)

Today the screens always say a copy was emailed, whether it went or not,
and there is no way to send it again.

Fix:
- **A record of every document email:** new table `document_emails` (one
  row per document per recipient: Renter or business; sent, failed, or no
  email on file; when). Tenant table with RLS like every other. It is a
  separate table because issued documents can never be changed (rule 12).
- **Screens say what really happened:**
  - Renter, after signing: "A copy has been emailed to you" only if it
    went; otherwise "We couldn't email you a copy. Ask {business} to send
    it."
  - Rental page (contract, changes, handover, return, swap): "Emailed to
    the Renter and to you", or "Not emailed to the Renter: no email on
    file", or "Couldn't email the Renter" with an **Email again** button.
    It sends the stored PDF (never a new one) and is logged.
- **A hiccup after the save is not "nothing was saved":** once the
  signature is saved, the screen always says it is done; the emailing
  afterwards can fail on its own and shows on the rental page as above.

### 10. After a swap, "Open handover report" opens the wrong report (G9-5, G4-2)

Fix:
- Every report button opens one document by its own ID, never "the latest
  of that kind".
- The Handover card opens the first handover report.
- Each swap on the Swap card lists its three papers: the swap form, the
  return report for the first car, the handover report for the second.
- No database change: each report already records which checklist it
  belongs to.

### 11. Who had the car, and when, isn't in the history (A6-12, G9-8)

Fix: possession starting and ending gets its own history line (with the
car and times) at handover, return and swap; so do swap checklists being
started and cars being reserved or released at a swap or return.

## D. Contract and change-of-terms links

### 12. Sending one change form stops another's link (A3-2)

Cause: the database allows one live change-form link per rental, not per
change.

Fix (migration): one live link per change. Sending or withdrawing a change
cancels only that change's link.

### 13. Links that can't be cancelled (A3-3)

Fix: a **Cancel link** button for the payments link (emailed or QR) and for
every change form's link, as the contract already has. Cancelling a link
never changes the rental or the change itself. Logged.

### 14. A changed contract shows as waiting when it can't be signed (A3-6)

Fix: the Contract card and each change on the Changes card check the sent
paper against today's details. If it no longer matches: "Changed since it
was sent: the Renter can't sign this link. Send it again." The check is
the same one the Renter's page makes, so the two always agree.

### 15. A replaced change can still be sent and signed (A3-12)

Fix: an end-date or ongoing change that a later one replaced shows
"Replaced by a later change": no Send button, its link is cancelled when
the later change is made, and signing it is refused (checked again inside
the save).

### 16. "Already signed, copy emailed" when nothing was signed (A3-7)

Fix:
- Two different answers: "This was signed already" (it really was) and
  "This link was stopped by {business} before you signed. Nothing was
  signed. Ask them for a new link."
- A Renter reopening their link after signing sees "This is already
  signed" rather than "may have expired". The link records that it was
  used (migration); the page says only that, and shows nothing about the
  Renter before the code is typed (rule 26).

### 17. Rate change loose ends (left over from batch 1, A3-1)

- The "rent week has begun" check is made again inside the save, so a
  signature pressed just before the week starts can't land after it.
- A rate change whose week has begun can't be sent again, and its card
  says "Not signed in time".
- That change stops blocking a new rate change: it is withdrawn by the
  system (logged) when the business proposes the next one.

### 18. Signing rules written in several places (A3-15, G9-11)

Fix: one shared set of rules in packages/core (when a contract or change
can be sent, when it can be signed, when it is replaced or out of time),
used by the cards, the send actions, the Renter's page and the final
check in the save. The repeated finishing steps of handover, return and
swap (locking, possession, car status, emailing) become shared steps.

## Database changes (migration 0045)

- `renter_links`: one live link per change (the unique index gains the
  change), and a `used_at` time set at signing; the token lookup can say
  "used" without any Renter details.
- `document_emails`: new tenant table (operator_id NOT NULL, RLS enabled
  and forced, grants for the business app only; the admin app gets
  nothing, rule 5). Append-only: a resend is a new row.
- Checklist photos: the database refuses confirming a photo on a finished
  checklist.
- Reports: the signature method (drawn or typed) and typed name recorded
  with each handover, return and swap signature (the signing record
  contracts already have, extended to them).

## Not in this batch

- Privacy items on the signing pages (no privacy notice, details shown on
  the change page, IP address in error logs: A3-9, A3-10, A3-11) go in
  batch 5 (privacy and records), where the notices are written together.
- Checklist details typed with no signal lost on reload (A6-6) and the
  other poor-signal items stay with the handover follow-ups.

## Tests

- **Browser (phone width, keyboard, accessibility):**
  - two strokes drawn, both in the signed PDF;
  - typed signature at handover, return and swap;
  - signing blocked while details are unsaved;
  - the swap form shown in full with the returned car's damage;
  - "Changed since it was sent", "Replaced", Cancel link and Email again
    on the rental page;
  - the Renter's "already signed" and "link stopped" pages.
- **Server and database:**
  - a checklist changed after the screen loaded: signing refused;
  - a signature for one swap refused on another;
  - a photo that can't load stops the report;
  - a WebP photo refused;
  - a name with Ł printed and read back from the PDF;
  - the signing time on the return report;
  - each document email recorded (sent, failed, no email) and resent;
  - a hiccup after the save still says done;
  - possession history lines;
  - per-change links;
  - replaced and out-of-time changes refused inside the save;
  - a stopped link gives the right answer;
  - another Operator can't see or resend another's document emails (tenant
    isolation).

## Senior review of this plan

- **Evidence:** every signature is now tied to a fingerprint of exactly
  what was shown, checked under the same lock that issues the document, so
  "what was signed" and "what is printed" can't drift (Electronic
  Transactions Act: reliable method, the signer's intention).
- **Immutability (rule 12):** nothing changes an issued document. Email
  status is a new append-only table; a resend sends the stored PDF.
- **Tenancy:** `document_emails` is a tenant table with forced RLS; resend
  is scoped by the session's Operator; the admin app gets no rights.
- **Renter links (rule 26):** "used" says nothing about the Renter before
  the code; links stay single-purpose and now single-change.
- **Edge cases:** no email on file; a business with no email; a Renter not
  present at return; a template edited mid-swap; the rent week starting
  mid-signing; two phones on one checklist.
- **Legal:** consumer law (terms shown before they're signed; a copy
  given), record keeping (complete reports, true signing times, possession
  history), accessibility (typing a name instead of drawing), the font's
  licence.

## Decision for Abhi

**The PDF font's licence.** Recommendation: Noto Sans (Google's font made
to cover every alphabet), under the SIL Open Font License, allowed for
fonts only.

Tradeoff: the OFL is a widely used free licence that lets fonts be
embedded in documents, but it isn't one of the code licences rule 32
lists, so it needs your say-so. The alternative is to keep the built-in
fonts and warn the business before signing when a name can't be printed,
which leaves those Renters' papers wrong.
