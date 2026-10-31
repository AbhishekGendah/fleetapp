# Phase 2 step 4 plan — Renter links (details form)

Status: approved (31 Oct 2026). Built (4a, 4b and 4c). Detail for slice 4 of
docs/plans/phase-2.md (approved in outline). The first kind of Renter link;
contract signing, booking view and payments reuse the same machinery later.

Built and deployed in three parts, each tested on the dev site first.

## How it works, in short

1. On a Renter's page the Operator presses **Send details form**. The Renter
   gets an email with a link (or the Operator copies the link and texts it).
2. The Renter opens it on their phone. The first time on that phone, they
   enter a 6-digit code emailed to them. That phone is then remembered for
   this link.
3. They see the privacy notice (naming the Operator), then a phone-first
   form: their details and licence, and photos of the licence front and
   back with the in-app camera. They press **Send to (Operator)**.
4. Nothing on the Renter's record changes yet. The Renter's page shows
   **Waiting for your review**. The Operator compares what was sent with
   what is on file, then **Approves** (copied in) or **Sends back** with a
   note (the Renter gets an email and can correct it with the same link).

## 4a — Sending the link, and the code

- **Send details form** (Renter page, Details tab) needs an email on file:
  the code goes by email, and SMS comes later (decision 2). It shows the
  link with **Copy link**, when it expires, and **Cancel link** /
  **Send again** (a new link; the old one stops working at once).
- **One details link per Renter** at a time. It lasts 7 days, a new setting
  under Settings → Renters ("Details form links last this many days", 1 to
  30) (rule 27).
- **The link** (rule 26): 32 random characters in the address; only a
  fingerprint (hash) of it is stored. It is for this one form only, expires,
  and can be cancelled.
- **The code:** 6 digits, emailed to the address on file, lasts 10 minutes,
  5 tries; then that link is locked and the Operator sends a new one. At most
  3 codes an hour per link. Once a code is right, that phone gets a private
  cookie (also stored as a hash) and is not asked again for this link.
- **Before the code is right the page shows almost nothing:** the
  Operator's business name and "We've emailed a code to s•••@gmail.com". No
  name, no details.
- **Emails** (React Email, the Operator's business name as the sender name,
  replies to the Operator's email): "Your details form from (Operator)" and
  "Your code". In dev they go to the test inbox; real sending needs Postmark,
  which is already on the go-live list.

## 4b — The form the Renter fills in

- Phone-first, the same rules and formatting as the Operator's forms (same
  Zod checks on the phone and the server). The privacy notice is at the top.
- **Their details** are filled in from what is on file, so they only correct
  what is wrong. **The licence is never shown back to them:** they type it
  and photograph it fresh (rule 26: links never show identity documents).
- **Licence photos:** Take photo (in-app camera) or choose a file, front and
  back. Shrunk on the phone and stored in the identity storage, like scans.
- **Address search** works on the form too, limited to 50 searches per link
  so a link cannot run up the Google bill.
- **Save as they go:** the form keeps what was typed on the phone if they
  lose signal or close the page, until they send it.
- After sending: "Thanks, (Operator) will check your details." They can open
  the link again to see that, but not what they sent.

## 4c — The Operator's review

- **Waiting for your review** shows on the Renter's page and as a badge and
  filter on the Renters list.
- **Review** page: each detail as "On file → Sent", changed ones
  highlighted; the licence; the two new photos behind **View** (logged, as
  scans are).
- **Approve:** copies the details in, the licence too (refused, as now, if
  another Renter has that licence, with a link), and the two photos become
  the licence scans (the old ones go to the 30-day bin). The Log shows each
  change as made by the Renter's link and approved by the User.
- **Send back** with a note: the Renter gets an email with the note and can
  correct and resend while the link lasts.
- A submission that is never approved is deleted with its photos 30 days
  after its link expires, by the daily clean-up.

## Database (one migration per part)

- **`renter_links`:** the Renter, what it is for (details form), the
  fingerprint, expiry, cancelled, the email it went to, the current code's
  fingerprint and expiry, tries, locked, who sent it. One live details link
  per Renter (database rule).
- **`renter_link_devices`:** the phones that passed the code (fingerprints).
- **`renter_submissions`:** what the Renter sent, its state (waiting, approved,
  sent back), the review note and who reviewed it.
- **Files:** a new kind, "submitted licence photo", in the identity storage,
  linked to its submission.
- **How a link finds its Operator without anyone signed in** (rule 3): one
  narrow database function turns a link fingerprint into its Operator and
  link, only for a live link, and nothing else. Everything after that runs
  inside that one Operator's data, as the daily clean-up does. Every change
  made through a link is logged with actor "renter link" (rule 19).
- All new tables: operator_id, forced row-level security, no deletes, no
  admin access, and the usual "Operator A cannot see Operator B" tests, plus
  tests that an expired, cancelled or locked link, a wrong code or another
  Operator's fingerprint gets nowhere.

## Security checks (written into the tests)

- The token is never logged, never in the activity log, and the link pages
  send no referrer (so the address does not leak to Google or anyone else)
  and are never cached.
- Guessing a link is not practical (32 random bytes); guessing a code is
  stopped by 5 tries per code and 3 codes an hour.
- A link only ever reads and writes its own Renter's submission.

## Legal side (into docs/legal-notes.md when built)

- **Privacy notice on the link page** (APP 5), naming the Operator as the one
  collecting: what is collected, why (to rent a car, deal with fines and
  tolls, contact them), who it may go to (the Operator, PintoFleet as its
  service provider, government agencies for fines), that the Operator's
  privacy policy says how to access or correct it, and that some is held
  overseas (email by Postmark in the USA). Wording to check with the lawyer.
- **Emails** to Renters are transactional (no marketing), so no unsubscribe
  link is needed under the Spam Act, but they say who they are from.
- **Postmark** (USA) sees Renters' names and email addresses: already in the
  overseas table; Postmark must be set up before real Renters get links.

## Test checklist

Each part adds its rows as it is built.

## Decisions in this plan (pushed back on easily)

1. **The link is always for a Renter the Operator has started** (decided in
   phase-2.md): no public sign-up form.
2. **Codes go by email only, for now**, so a Renter needs an email to use a
   link. Tradeoff: a Renter with only a phone gets the form filled in by the
   Operator until SMS is set up (provider still to choose).
3. **The Renter's current details are filled in, the licence is not.**
   Tradeoff: they must retype the licence each time, but a forwarded link can
   never reveal it.
4. **Nothing changes until the Operator approves.** Tradeoff: one more step,
   but a typo or a stranger cannot overwrite a record.
5. **7 days, 6-digit code, 10 minutes, 5 tries, 3 codes an hour**, as in the
   design. The link lifetime is a setting; the code rules are fixed.
