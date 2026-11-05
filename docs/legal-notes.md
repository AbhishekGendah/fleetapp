# Legal notes

A running list of everything with a legal side: what the privacy
policy, the terms and the Operator agreement will need to say, and
what needs a lawyer's view. Added to as each feature is built. These
are notes, not legal advice: have a lawyer review before the first
real Operator goes live.

Each entry gives: what happens, why it matters, and what to do.

## Who is responsible for what (decide with a lawyer)

- Operators collect Renters' personal information, and PintoFleet holds
  it on their behalf. The Operator agreement needs to say who is
  responsible for what under the Privacy Act 1988 (Australian Privacy
  Principles, "APPs"): usually the Operator for why they collect it, and
  AGS for keeping it safe.
- The Privacy Act's small business exemption (turnover under $3M) may
  not apply to AGS or Operators: it does not cover businesses that hold
  personal information for others or trade in it. Get a view on this
  before assuming either is exempt.
- Notifiable Data Breaches scheme: if Renter data leaks, affected
  people and the OAIC may have to be told. The Operator agreement should
  say who tells whom, and how fast.

## Sending data overseas (APP 8)

Each of these services may process personal information outside
Australia, or is run by an overseas company even when the data is
stored in Sydney. The privacy policy needs to name them (or the kinds
of service) and the countries.

| Service                                   | What it sees                                                                                                                       | Where                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Google Places (address lookup)            | Address text as it is typed; nothing else                                                                                          | Google, worldwide              |
| Have I Been Pwned (leaked-password check) | 5 characters of a scrambled fingerprint of a new password; not personal information, and the password cannot be worked out from it | Run from Cloudflare, worldwide |
| Postmark (email, live)                    | Names, email addresses, email contents (signed PDFs, reports with photos, invoices)                                                 | USA                            |
| Stripe (payments, live)                   | Renter names and emails, bank and card details (typed into Stripe), payment history                                                | Stripe, Australia and USA      |
| Vercel (hosting)                          | Everything passing through the app; functions run in Sydney                                                                        | US company                     |
| Neon (database)                           | Everything stored; data in Sydney                                                                                                  | US company                     |
| AWS S3 (files, live)                      | Photos, documents and licence scans; stored in Sydney                                                                              | US company                     |
| SMS provider (TBD)                        | Renter phone numbers and message text                                                                                              | TBD                            |

## Address lookup (Google Places)

- **What happens:** as someone types an address, the typed text goes to
  Google to get suggestions. It goes from our server, so Google does not
  see the person's IP address or browser. No name or phone number is
  sent with it.
- **Privacy policy:** one line saying addresses are looked up with
  Google and may be processed overseas.
- **Google's terms:** suggestions shown without a Google map must show
  the Google logo. Google forbids storing its content except place IDs,
  but its policy page has a carve-out for a street address the person
  could have typed themselves without the lookup. Our app saves only
  the address the person chose, as their own entry.
  **To confirm:** read the full carve-out on Google's Places policy page
  (developers.google.com/maps/documentation/places/web-service/policies)
  before go-live. That site was not reachable from the build environment.
- **Logo, to do before go-live:** the suggestion list says "Powered by
  Google" in text for now. Google's terms ask for its logo image; swap it
  in from Google's official logo files (download from Google's Maps
  Platform attribution page).
- **Never logged:** what was typed, or the error text Google sends back
  (it can quote the address). Only the kind of failure is logged.

## Logins and devices (already built)

- Two cookies are needed to sign in: the session, and "remember this
  device" (14 days, only if ticked). A third, long-lived cookie
  recognises a browser so the User can be emailed when a new device
  signs in. The privacy policy should list them. They are essential, so
  Australia has no cookie consent law today, so no banner is expected (confirm with the lawyer).
- The "add to home screen" guide remembers that it was dismissed in the
  browser's own storage on that phone (no personal information, never
  sent to us). Essential-style preference; list it with the cookies.
- Sign-ins, failed sign-ins and lockouts are recorded in the activity
  log with the time and the kind of device. The privacy policy should
  say what is logged and for how long.

## Stored files (logo, car photos, documents and attachments built)

- Files are stored with Amazon S3 in Sydney (an American company; already
  in the overseas table). Both buckets are private; files are only ever
  shown through links that expire in minutes, issued after checking who
  is asking.
- No original file names are kept, because they often contain people's
  names.
- Images are redrawn on the device before upload, which also removes the
  hidden details phones add to photos, such as the GPS location where a
  photo was taken. Worth saying in the privacy policy.
- Deleted files are kept 30 days, then removed for good (rule 23).
- **Car photos** can show people, number plates of other cars, or a home
  in the background. They are the Operator's records; the privacy policy
  should say photos of cars are kept to record their condition. Operators
  should avoid photographing people.
- **The in-app camera** asks the phone for permission once and only runs
  while it is open; nothing is recorded but the photos taken. Photo names
  use only the rego, date and a number.
- **Car documents** are named by the Operator; the name is kept, the
  file's own name is not. A document showing someone's licence or identity
  (e.g. a transfer form) belongs on the purchase or sale, not here; the
  Documents tab says so.
- **The in-app photo viewer** shows a photo or image paper only when it is
  opened, through the same short-lived link; opening a purchase or sale
  paper there is logged each time, as before.
- **Attachments** on rego, insurance and costs go in the ordinary storage.
  Papers attached to a purchase or sale go in the separate identity
  storage (rule 8), as they usually show the other person's licence and
  date of birth. Every opening of one is written to the car's Log with who
  opened it. Admins cannot open any of them. Attachment names use only the
  rego, what the record is and a number, never the other person's name.
- **Before go-live:** each bucket's own clean-up rule keeps an old copy
  for another 30 days after the app removes a file, so a file can last
  about 60 days in all. Fine for dev (no personal data). The production
  buckets must use 7 days, so "removed after 30 days" stays true for
  Renter photos and licence scans (APP 11.2, deletion requests, breach
  exposure).

## Exports (built for the admin Operator list)

- A CSV or Excel export copies data onto someone's own computer, where we
  no longer control it. Exports are never cached by browsers or proxies,
  and cells that look like formulas are made plain text so a file cannot
  run anything when opened.
- **Renters list export (built):** each download is recorded in the
  Operator's activity log (who, when, CSV or Excel, how many rows). It holds
  name, phone, email and status only. The privacy policy and the Operator
  terms should still say Operators are responsible for what they export.

## Cars (Phase 2 step 1, built)

- A car's rego, VIN and details are not personal information on their own.
  They can become so once linked to a Renter (who had which car when), which
  arrives with rentals in Phase 3: treat car history as personal from then.
- The built-in make and model list uses manufacturers' names only to
  describe the cars, which trade mark law allows. No logos are used, and no
  paid or copied database: the list was compiled from public information.
- Car exports (CSV/Excel) hold no personal information today. When rentals
  add Renter names to car lists, the export rules under "Exports" apply.

## Car models list (built)

- AGS keeps one shared list of car makes and models; every Operator's car
  form suggests from it. Names of cars only, no personal information.
- **AGS can correct an Operator's car's make and model** from the admin
  site ("Typed by Operators"). This is the one place AGS changes an
  Operator's records. The change is limited to make and model, shows in
  the car's History as made by AGS, and is in AGS's own admin log. **The
  Operator terms should say AGS may correct car make and model names to
  keep the shared list consistent.**
- To do this, the admin site sees, for cars not in the list: the Operator's
  business name, the make and model typed, and when the car was added.
  Nothing else about the car, and nothing about Renters.

## Rego and insurance (Phase 2 step 2a, built)

- Rego renewals and insurance policies are business records, not personal
  information. Policy numbers and costs stay inside the Operator's account;
  the admin app cannot see them.
- **Record keeping:** rego and insurance costs (with their GST) are tax
  records. Removing a renewal or archiving a policy only hides it; the
  record stays, so the Operator can still produce it.
- **GST:** the app records the GST shown on each bill: a tenth prefilled for
  insurance premiums (changeable), copied from the notice for rego (only
  its injury-insurance part carries GST), and none at all for an Operator
  not registered for GST in Settings. It does not decide whether the Operator can claim it; that
  is between the Operator and their accountant. Worth a line in the terms.
- **Insurance excess** is recorded now and will be used to cap damage
  recovery charged to Renters (Phase 3/4). Charging a Renter more than the
  contract allows is a consumer-law risk; check when that is built.

## Purchase, sale and costs (Phase 2 step 2b, built)

- **Sellers' and buyers' details are personal information** (the Privacy
  Act applies even though they are not Renters): name, phone, address and
  the buyer's licence number. Collected to prove when ownership changed and
  to pass on a fine that arrives after a sale. The privacy policy and the
  Operator terms should say so.
- They stay inside the Operator's account. The admin app has no access to
  the tables, and the history (which AGS staff can read) records only that
  a detail changed, never the detail itself. Licence numbers are never
  logged (rule 7).
- **Transfer of ownership:** the sale screen reminds the Operator that fines
  can still reach them until the transfer is lodged. The rules (who lodges,
  by when, stamp duty) differ by state; check each when fines are built
  (Phase 6).
- **Record keeping:** purchase and sale details and costs are tax records
  (5 years). Removing a cost or cancelling a sale only hides it; the record
  stays.
- **Transfer papers and receipts** attach to the purchase or sale and go in
  the private identity storage (rule 8). They are tax records too: removing
  one hides it and keeps it 30 days, so keep a copy elsewhere if it is the
  only one. Decide with the accountant whether removal should be blocked
  for 5 years instead.

## Renters (Phase 2 step 3 built)

- **Renters' personal information is now collected:** name, preferred name,
  phone, email, date of birth, home and postal address, and an emergency
  contact (a third person's details: the privacy policy should say they are
  kept only to reach someone in an emergency). Before the first real
  Operator, the privacy policy, the Renter privacy notice and the Operator
  terms need the lawyer.
- **The admin app has no access to Renters at all** (no database grant), and
  a test proves it. Renters are never shared between Operators.
- **The Log never holds Renter details**, only which one changed. Status
  changes show Active / Do not rent, but not the reason.
- **Do not rent reasons** can be asked for by the Renter (APP 12), and one
  about a crime or health would be "sensitive information". The screen
  says: private to your business, facts only, the Renter can ask to see it.
- **Same phone or email** is only a note, not a block, so families can share.
- **Licences (part 2):** number, where issued (state or country), class, type
  and expiry. The licence number is never in the Log or the list export
  (rule 7). One Renter per licence, archived ones included.
- **Licence scans** are identity documents (rule 8): kept in the private
  identity storage, never shown as previews, opened only by pressing View
  through a 5-minute link, and every View is written to the Renter's Log with
  who looked. A replaced or removed scan is kept 30 days, then deleted.
  Licence scans are deleted on a timer (built, step 5, APP 11.2): to the bin
  12 months (an Operator setting, 1 to 60) after the later of being added and
  the Renter's last rental, never while a rental, fine or dispute is open,
  then gone 30 days later. The licence details themselves are kept (fines,
  tax records). The privacy policy template states this.
- **Notes (part 3)** are personal information about the Renter: the screen
  says facts only and that the Renter can ask to see them. A note is never
  edited; one removed by mistake is kept (in the download, marked removed).
  The Log never holds what a note says.
- **Access requests (APP 12):** "Download everything we hold" gives the
  Operator one Excel file with the Renter's details, licence (number
  included), status and reason, notes, when each scan was added and
  removed, and the full Log. The scans themselves are opened from the page
  if the Renter wants copies. Each download is logged. The Operator terms
  should say the Operator answers access requests within 30 days (APP 12
  requires a reasonable time) and checks who is asking before handing it
  over.
- **Overseas licences:** the form says visitors can drive on one only for a
  limited time and it must be in English or come with an International
  Driving Permit. The exact limits differ by state (e.g. three months after
  becoming a resident in most): check each before go-live, and whether the
  app should ask when the Renter arrived in Australia.

## Renter links (Phase 2 step 4, parts 1 and 2 built)

- **Sending a link:** the Renter's email address goes to the email provider
  (the test inbox in dev; Postmark, USA, in production: already in the
  overseas table). Emails come from the Operator's business name and replies
  go to the Operator's email, so the Renter knows who is contacting them.
  They are transactional (no marketing), so the Spam Act's unsubscribe rule
  does not apply, but they say who sent them and why.
- **Security (rule 26):** only fingerprints of links, codes and remembered
  phones are kept; links expire (7 days unless changed), can be cancelled,
  and a new link replaces the old one; a 6-digit code is needed on a new
  phone (10 minutes each; 10 wrong codes over the link's life lock it; at
  most 3 codes an hour; the code is never in the email's subject or preview).
  A link also stops once its details are approved, the Renter is archived,
  their email changes, or the Operator is suspended.
  Before the code the page shows only the business name and a masked email.
  Link pages send no referrer, are never cached and are not indexed.
- **Logged:** every link sent, cancelled, code emailed, phone confirmed and
  lock, as done by the Renter's link or the User. Never the address or code.
- **Privacy notice on the form (APP 5), built; wording to check with the
  lawyer before real Renters get links.** It names the Operator as the one
  collecting and says: why (renting, tolls, fines, damage, contact), that
  without the details the Operator may not be able to rent; who sees them
  (the Operator, PintoFleet as its system, government agencies for fines and
  tolls); the overseas services (email in the USA, Google for the address
  search); and that the Operator's privacy policy says how to access or
  correct them and complain. Each Operator needs a privacy policy for this to
  point to: AGS supplies a template (decided 31 Oct 2026), drafted from the
  OAIC's APP 1 guidance at docs/legal/renter-privacy-policy-template.md, for
  one lawyer review before launch. The Operator terms should say the template
  is a starting point and each Operator is responsible for it fitting their
  business. Keep the template in step with what the app collects: update it
  in the same task whenever a new kind of Renter data or overseas service is
  added.
- **What the Renter sends is held, not applied:** it waits for the
  Operator's review (part 3) and the record does not change until approved.
  Licence photos go to the identity storage as for scans, are never shown
  back on the link, and a new photo for a side sends the last one to the
  30-day bin. Sending is logged as done by the Renter's link; what was sent
  is never written into the log.
- **The Operator's review (part 3, built):** approving copies the details in
  and the photos become the licence scans; each change is logged as made by
  the User who approved, after the Renter's link sent it. Sending back emails
  the Operator's note to the Renter (transactional, from the Operator's name)
  and shows it on the link; the note is never written into the log. Photos
  are opened only behind View, every look logged.
- **Retention of what was sent (built, step 5):** everything a Renter sent
  through a link, approved included, is removed 30 days after the link ended
  (photos to the bin, gone 30 days later). Approved details are on the record
  by then; the Log keeps that they were sent and who approved them.
- **APP 12 (built):** "Download everything we hold" has a "Sent through link"
  sheet with what is still held.
- **The form is kept on the Renter's own phone (browser storage) while they
  type** (changed after the code review): only boxes they change, never the
  licence number; old kept forms are swept on every visit and forgotten once
  sent. On a shared computer someone after them could still see unsent
  changes (address, date of birth) until the link ends. Acceptable for now
  (their own data, on a device they chose).
- **Address search on the link** is limited to 50 per link so a link cannot
  run up the Google bill; Google sees the address text typed (already in the
  overseas table).

## Bookings (Phase 3 slice 1, built)

- **Personal information:** a rental links a Renter to a car and dates
  (where and when someone has a car). It stays inside the Operator's own
  records: row-level security keeps it to that Operator, and the admin app
  has no access to rentals, rates or car holds (tested). Nothing new is
  sent overseas: calendar and date pickers run in the browser.
- **Log:** the rental's notes and a cancellation reason may hold personal
  details, so the Log records only that they were set, never what they say
  (the same rule as Renter notes). The warnings a booking went ahead with
  (e.g. "licence expires during the rental") are logged as codes.
- **Settings copied onto each rental (rule 14):** the terms a rental was
  made under can be shown later, which helps if a Renter disputes them
  (consumer law: the Operator must apply the terms agreed at the time).
- **Minimum age and provisional licences:** set by each Operator, to match
  their insurance. The Age Discrimination Act 2004 has an exemption for
  terms based on insurance or actuarial data, which is how car hire age
  limits are usually justified; the lawyer should confirm it covers an
  Operator's own limit. The Operator terms should say the Operator sets and
  is responsible for these rules. Added to the launch checklist.
- **Do not rent:** a Renter marked Do not rent cannot be booked. The reason
  stays the Operator's private note (already covered under Renters).

## Contract templates and issued documents (Phase 3 slice 2, built)

- **No legal wording from AGS:** the starter template gives layout,
  headings and "write your terms here" notes only, with a note at the top
  to have the finished contract checked by a lawyer. The Operator writes
  and owns their terms (unfair contract terms law applies to standard-form
  contracts, with penalties). The Operator terms should say so; already on
  the lawyer list.
- **Record keeping (rule 12):** every saved template version is kept
  unchanged; issued documents (the PDF and its SHA-256 fingerprint) can
  never be changed or removed, nor their PDF file binned, by anyone,
  including the database's top login (tested). Contracts are commonly kept
  7 years; decide the retention period with the lawyer before any deletion
  rule touches them.
- **Personal information in PDFs:** a filled-in contract holds the
  Renter's name, date of birth, address, phone, email and licence number.
  Previews are made on request, never stored, and sent with "no-store" so
  no browser or proxy keeps a copy. Stored (issued) PDFs come with signing
  in slice 3, in general storage (a contract is not an identity document)
  and opened only through 5-minute links.
- **Overseas:** PDFs are made on our own servers (Vercel, Sydney) with an
  open-source library; nothing is sent to another service.

## Handover on the Operator's phone (Phase 3 slice 5, built)

- **The Renter's acceptance (Electronic Transactions Act):** the Renter
  signs with their finger on the Operator's phone, in person. The app
  records who was signed in (the Operator's User), when, the exact words
  accepted and the signature, inside the fixed report. Identity rests on
  the Operator checking the Renter against their licence at the car: the
  Operator terms and training notes should say so (add to the lawyer list
  with the signing record question).
- **Possession (fines, tolls):** possession starts at the moment of
  acceptance and is recorded against the car with no overlaps allowed.
  This is the record fines are matched to in Phase 6, so the time must be
  right: it is the server's clock at acceptance, never typed.
- **Photos (APP 3, 11):** handover photos show the car, but can catch
  people, other number plates or the inside of the car (belongings).
  They are kept with the rental like other car photos, in general
  storage, and can no longer be removed once the handover is finished
  (they are evidence). The retention period for car photos is still to
  be set with the lawyer (already on the list); rule 23's move to cheaper
  storage after a year applies.
- **Kept on the phone (APP 11, security):** while a handover is under way
  the phone keeps what was typed, the photos waiting to send and the
  checklist page (the Renter's name, the car, the kilometres). Only the
  handover page is kept, never other pages. It is wiped once the Renter
  accepts on that phone, and anything older than 7 days is wiped
  automatically. A lost phone still holds up to a week of handovers: the
  Operator terms should ask Operators to lock their phones (screen lock).
- **Bond short at handover:** the Operator can hand the car over with the
  bond not yet paid only by giving a reason; the reason is kept with the
  handover and the Log records that it happened.
- **Emails:** the report goes to the Renter and to the business email, as
  for signed contracts (transactional; Postmark when set up).

- **No GST on a bond:** it is security, not payment for a supply, so no
  GST is recorded on it. When part of a bond is kept to cover a charge
  (damage, unpaid rent; Phase 4), GST follows that charge's own type, not
  the bond. Confirm with the accountant before Phase 4 (on the list).
- **Not a residential bond:** the state bond-lodgement schemes (e.g. WA's
  Bond Administrator) cover tenancies, not vehicle rentals, so the
  Operator holds the bond themselves. The Operator's contract must say
  when the bond is paid, what it can be used for and when it is returned
  (the starter template has a note for this). Australian Consumer Law:
  keeping a bond without a basis in the contract can be challenged.
- **Record keeping:** bond entries are never changed or deleted; mistakes
  are corrected by a cancelling entry with the reason, so the history is
  complete for disputes and the tax records (5 years).
- **Personal information:** a bank transfer reference can hold a name, so
  references and correction reasons stay with the bond and never go into
  the activity log (rule 7). The admin app cannot read bond entries.

- **Electronic Transactions Act 1999 (Cth) s 10, and each state's own Act (e.g. WA 2011):** the
  signer is identified (a code emailed to them, typed on their phone), the
  method shows their intention (they sign the exact text they read; its
  fingerprint is checked and recorded), it is reliable (each step is
  recorded with time, internet address and browser) and they consent to
  signing electronically (a separate tick, with the exact words kept).
  Some documents can't be signed electronically in some states (e.g.
  deeds, statutory declarations): a rental contract is fine, but fines
  nominations (Phase 6) must be checked. Add to the lawyer list: confirm
  the signing record page is enough for each state.
- **What is stored (APP 3, 11):** for each signing step, the time, the
  internet address and the browser description; for the signature, the
  method, the typed name or the drawn image (inside the PDF), and the
  consent words. Kept as signing evidence, never in the activity log or
  error logs (rule 7). Append-only: no one can change or delete it,
  including AGS. The admin app cannot read it.
- **Privacy notice:** the Operator's privacy policy should say that
  signing records the internet address and device used, and why (proof
  of who signed). Add to the Operator terms / privacy template list.
- **Emailed copies:** the signed PDF (with the Renter's details) is
  emailed to the Renter and to the business email in Settings. Emails
  pass through Postmark (US) once it is set up: already disclosed as
  overseas sending for codes and links; the attachment adds the contract
  itself, so the disclosure should name "documents you sign" too.
- **Record keeping:** the signed PDF and its fingerprint are kept for good
  like every issued document (retention period still to be set with the
  lawyer, see Contract templates above). Spam Act: these are transactional
  emails (no marketing, no unsubscribe needed).
- **Changes after sending (rule 14):** if the rental's details or the
  template change after the link was sent, signing is refused and a new
  link must be sent, so a Renter never signs text other than what they
  were sent.

- The admin login reads only who did what and when in Operators' history,
  never the values (database column grants, migration 0025), so Renter or
  car details can never reach AGS staff that way, whatever a future change
  writes into the history (rule 5, APP 6 and 11).
- Production refuses to start with the test inbox, which holds working
  Renter links and codes; the test inbox exists in dev only (fake data).

## Return (Phase 3 slice 6a, built)

- **Possession end (fines, tolls):** possession ends at the return time
  the business records, which can be entered later for an after-hours
  drop-off. It can never be before the handover or in the future, and the
  Log shows who entered it and when, so the record of who had the car is
  defensible if a fine is disputed.
- **The Renter's signature at return is optional** (design 05): when they
  are not there, the report says so in plain words and that the business
  recorded the return. Operators who want the Renter's signature every
  time can switch on "Must the Renter sign when the car comes back?". Add
  to the lawyer list with the handover acceptance: whether an unsigned
  return report is enough evidence of the car's condition for a damage
  claim against the Renter (consumer law: unfair terms if the contract
  makes the Renter liable for damage they never saw recorded).
- **Return report:** fixed with its fingerprint (rule 12) and emailed to
  the Renter and the business, as the handover report. Photos at handover
  and return sit side by side; new damage is listed separately.
- **Bond:** the card shows how long the bond is kept after the return
  (the rental's own setting). Refunds or deductions are Phase 4; any
  deduction for damage will need the Renter told why (consumer law).

## Damage records and insurance claims (Phase 3 slice 6b, built)

- **Who had the car is a suggestion, never a charge:** for damage found
  away from a return, the app suggests the Renter who had the car that day
  from possession (rule 15) and the Operator confirms or clears it. Nothing
  is charged or sent to the Renter here; recovering a repair or the excess
  is Phase 4, where the Renter must be told what they are charged for and
  why (consumer law: no charge for damage they did not cause, and a fair
  chance to dispute it).
- **Personal data:** a damage record links to a Renter, so it is part of
  "Download everything we hold" for them once that covers damage (see
  "Coming with later features"). Claim numbers and insurer notes are business records, not
  identity documents. Admin cannot read them (rule 5).
- **Record keeping:** records are archived, never deleted; one from a
  return cannot be removed at all, only marked Not repairing, so the
  history behind a later claim stays complete.

## Changes of terms (Phase 3 slice 7a, built)

- **A rate rise needs the Renter's agreement:** a new weekly rate is sent
  as a change-of-terms form and counts only once the Renter signs it.
  Consumer law: a term letting the business change the price on its own
  is likely unfair (Australian Consumer Law, unfair contract terms). Ask
  the lawyer whether an end-date change also needs the Renter's signature
  in every case; for now it takes effect at once (agreed with the Renter)
  and can be sent to sign.
- **Direct debit:** before Phase 4 charges from a new rate, confirm
  Stripe's notice rule for a changed direct debit amount (decision 5).
  The earliest a rate can start today is tomorrow.
- **Short notice:** ending an ongoing rental with less notice than the
  rental's terms is allowed (the parties may agree it) and logged.
- **Signing wording:** the Renter agrees to sign "this contract"
  electronically on the change-of-terms form too; check with the lawyer
  that this wording suits a change of terms (add to the lawyer list).
- **Record keeping:** each change is kept for good with its reason, who
  made it and the signed form (rule 12 for the PDF).

## The ledger and charges (Phase 4 slice 1, built)

- **GST per charge type:** every built-in type starts as including GST;
  the business sets each in Settings → Charges. **Ask the accountant**
  which are taxable for a vehicle rental business: damage recovery and the
  insurance excess passed on (often treated as compensation, not a supply),
  tolls passed on at cost, and late fees. Until then an Operator can set
  any of them to GST-free or not subject to GST, and each line keeps the
  GST it was added with.
- **Rent from the handover, in advance:** the Renter pays for days they
  have the car, from the handover, not the planned start. An early return
  credits the unused days (when part weeks are charged by the day; the
  rental's own setting, agreed in the contract).
- **Charging for damage:** the charge says what it is for, and is added
  only once the rental is confirmed as the one that had the car. The
  screen reminds the Operator to charge only what the contract allows
  (Australian Consumer Law: unfair terms; the Renter must be able to see
  and dispute it).
- **Record keeping:** the ledger is a tax record: kept for good (at least
  5 years under the ATO's rules), never changed, corrections as
  reversals. The retention jobs never touch it.
- **Privacy:** payment references are the Operator's own; no bank or card
  details are stored (rule 7). Admin cannot read the ledger (rule 5).

## Invoices, credit notes, receipts and statements (Phase 4 slice 2, built)

- **Tax invoices (GST Act, ATO):** while the business is GST-registered
  on the issue date, an invoice is titled "Tax invoice" and shows the
  business's name and ABN, the date, each item with its price, how far
  each is taxable (GST in it, GST-free or no GST), the GST total, and the
  Renter's name (the ATO asks for the buyer's identity from $1,000; it is
  always shown). Otherwise it is an "Invoice" with no GST shown.
  **Ask the accountant:** whether issuing each week's invoice in advance
  on the charge day is the right tax point; whether a one-off charge held
  for the next weekly invoice is fine; and that the address and contact
  lines are enough (they come from Settings → Business details).
- **Adjustment notes:** a correction (a reversed charge, unused days
  credited) is issued as an "Adjustment note" while registered (GST Act
  s29-75), naming the invoice it corrects; otherwise a "Credit note".
  The ATO's Adjustment Note Information Requirements Determination 2022
  lists what one must hold. **Ask the accountant** to check ours against
  it (the business, the Renter, the date, the invoice corrected, each
  item and the GST taken off).
- **Numbers:** in sequence per business with no gaps (rule 17):
  invoices and credit notes share one run; receipts have their own. The
  database refuses a gap or a repeat.
- **Fixed once issued (rule 12):** each document's PDF is kept with its
  SHA-256 fingerprint, never changed; a prefix change never renumbers one.
- **Record keeping:** invoices, adjustment notes, receipts and statements
  are tax records: kept at least 5 years (ATO). The retention jobs never
  touch them.
- **Email:** each document goes to the Renter from the business (replies
  go to the business), as a transactional message about their rental, not
  marketing (Spam Act: no unsubscribe needed; it names the sender). An
  Operator can turn automatic emails off in Settings → Invoices.
- **How to pay:** the business may print its own payment details (e.g. its
  bank account for transfers) under its invoices. These are the
  Operator's own details, typed by them, not a Renter's (CLAUDE.md rule 7
  clarified 3 Nov 2026). A wrong number would go out on every invoice: the
  box says to check it.
- **Privacy:** the Renter's name and their car's rego are on each
  document, as on their contract. No bank or card details of the Renter
  are stored. Admin cannot read any of it (rule 5).

## Stripe accounts (Phase 4 slice 3, built)

- **Each business is the merchant** on its own Stripe account (full
  dashboard): it accepts Stripe's Services Agreement and Connected Account
  Agreement on Stripe's own pages, gives its details to Stripe there, pays
  Stripe's fees and handles its own refunds and disputes. AGS takes no
  cut. **AGS must accept Stripe Connect's platform terms** when turning
  Connect on, and the AGS terms with Operators should say payments are
  between the business, Stripe and the Renter.
- **What goes to Stripe from us:** only the business's name and email, to
  start its account. Its other details (ABN, bank account, the owners' ID)
  are typed into Stripe's pages, never ours. Stripe holds data in
  Australia and overseas (US): the privacy policy says so (APP 8).
- **What we keep:** the Stripe account's ID and three status values, and
  each Stripe event's ID and type (to handle it once). No bank, card or ID
  details (rule 7). Admin cannot read any of it (rule 5).
- **BECS limits:** new Stripe accounts start with low direct-debit
  limits; the page tells the business to ask Stripe for higher ones.

## Renter direct debit and bond (Phase 4 slice 4, built)

- **The Renter gives their bank or card details on Stripe's own page**, on
  the business's Stripe account. We store only Stripe's IDs and the method
  type (rule 7). The Renter's name and email go to Stripe to make them a
  customer of the business. Stripe holds data in Australia and overseas
  (US): the payments page says so, and the privacy policy must (APP 8).
- **The Direct Debit Request and service agreement are Stripe's**, shown
  and accepted on Stripe's page in the business's name. The Renter's
  acceptance is recorded by Stripe (the mandate); we keep its ID. A Renter
  can dispute a BECS debit with their bank for up to 7 years: the
  business's best evidence is Stripe's mandate, made by the Renter on
  their own device.
- **"Set up on the spot"** shows the Renter's link as a QR code on the
  Operator's phone; the Renter still types the emailed code and their own
  details on their own phone (or on the Operator's, while the Operator
  watches). The Operator never types a Renter's bank details.
- **Question for Stripe (Abhi to ask):** can a business enter a Renter's
  BECS details from a signed paper Direct Debit Request, and what must that
  form say and how long must it be kept? Until Stripe answers yes, the app
  offers only the Renter-typed way (rule 7 also forbids us holding them).
- **Bond by bank debit** takes up to 3 business days to clear; it counts
  only once Stripe says it succeeded (decision 2). A bounced one is shown
  and can be paid again. Refunds of a card bond come with closing a rental
  (slice 7).
- **Record keeping:** payments are tax-related records, kept with the
  ledger (never deleted by retention jobs). Admin cannot read any of it
  (rule 5).

## Rent in 24-hour blocks (review fixes batch 1, 4 Nov 2026, built)

- **Price terms the Renter agrees to:** rent is counted in 24-hour blocks from
  the signed handover, with a grace period (default 60 minutes) before another
  day is charged. A long-term rental (booked for the minimum, default 7 days,
  or ongoing) that ends sooner is re-priced at the daily rate unless the
  business waives it. Consumer law: a price rule the Renter has not agreed to
  is not enforceable and could be unfair, so these must be stated in the
  contract they sign. Built: merge fields for the daily rate, long-term
  weekly price, minimum and grace period, and wording in the default
  contract. A business's own contract that leaves any of them out shows a
  warning on its template page, as Renters on it have not agreed to them.
  Older templates still print the weekly rate and charge day correctly.
- **Rate changes** start at a rent week's start and can't be signed after it
  has begun, so a signed form always matches what is charged (no backdating).
  Phase 4 decision 3 (30 days' notice of a new debit amount for direct-debit
  Renters) is still to confirm with Stripe before slice 5.
- **Record keeping and GST:** every correction to rent already invoiced gets
  its own tax invoice or adjustment note. An adjustment note follows the tax
  status of the invoice it corrects, names what it takes back and prints
  reductions as minus amounts. Taking back a credit gets a tax invoice.
- **The daily-rate waiver's reason** is the business's own note: kept on the
  rental, shown to the business only, never printed for the Renter, and
  logged only as "waived" (it may say something personal).
- **AGS alert email** (`OPS_ALERT_EMAIL`) carries counts and business IDs only,
  never Renter details (rule 7).

## Fleet timeline (3 Nov 2026)

- **No new data or third party:** it shows the rentals already on the
  Rentals and Calendar pages (Renter's name, car, dates). DayPilot Lite
  runs wholly in the browser and sends nothing anywhere. Its licence
  (Apache-2.0) is listed in the third-party licences file with each build.

## Car swaps (Phase 3 slice 7b, built)

- **The Renter's acceptance:** the Renter signs the swap form on the
  Operator's phone, after reading that they hand back one car and accept
  the other in the condition shown in each checklist. The rest of the
  rental stays the same. The moment they sign is when possession moves
  (rule 15), so a fine is matched to the right car. Ask the lawyer whether
  this on-phone signature with that wording is enough (add to the lawyer
  list), as it is for the handover.
- **Copies:** the swap form and both reports are emailed to the Renter,
  as for the handover and return. They are transactional emails, so the
  Spam Act's unsubscribe rule does not apply.
- **Record keeping:** finished swaps can never be changed or deleted;
  each keeps its reason, who started it and the three documents (rule 12).
- **Privacy:** no new personal information is collected. Admin cannot
  read swaps (rule 5).

## Demo data (test site only, 2 Nov 2026)

- Every demo record is made up: names, emails at example.test (a domain
  reserved for testing, so nothing can reach a real person), phone numbers
  from the range the Australian regulator keeps for fiction, regos starting
  DEMO, licence numbers starting 41, sellers and insurers with made-up
  names. Licence "scans" and photos are drawings marked DEMO. Nothing is
  sent outside the test inbox, so the Spam Act and privacy rules are not
  engaged. Demo contracts carry a notice that nobody really signed them.
- The tool is refused on the live site (see docs/launch-checklist.md), so
  demo records can never sit beside real Renters' data.

## Business details (already built)

- An Operator's ABN, address, phone and email are business information,
  not personal information, unless the Operator is a sole trader. Then
  they are personal and the APPs apply. Treat them with the same care.
- Legal name, ABN, address, phone and email are required. A tax invoice
  must show the seller's identity and ABN (GST law), and the Operator's
  contact details belong on every rental contract. Invoices are built in a
  later phase; this makes sure the details are there when they are.

## Bond and direct debit (review fixes batch 2, 4 Nov 2026, built)

- **What the business sees:** the payments page no longer says the business
  "never sees" bank or card details. It says the business sees only the
  last digits, and nobody can take money with them (consumer law: no
  misleading statements; privacy: APP 5 notice accuracy).
- **Bond paid twice:** the app now stops a Renter paying the bond twice on
  Stripe's page, and stops staff recording cash while a bank debit for it
  is still clearing (consumer law: no taking more than agreed).
- **Bond owed back:** a bond that arrives after a booking was cancelled is
  shown as "Bond to refund" until refunded. Refunds and disputes made in
  Stripe are recorded on the bond by themselves (record keeping). Refunding
  a cash bond by hand comes with Phase 4 slice 7 (launch checklist).
- **Old direct debits:** a direct debit the Renter replaced is cancelled at
  Stripe straight away (Stripe's terms and the Direct Debit Request: only
  the account the Renter chose may be debited).
- **Stripe's copy of the Renter:** a corrected name or email is sent to
  Stripe, so direct-debit notices Stripe sends reach the Renter, not an old
  inbox (privacy: APP 10, keeping personal information accurate; and the
  advance notice of debits the Direct Debit Request promises).
- **Test payments on the live site:** the live site refuses Stripe's test
  key, so a fake test card can't "pay" a bond there.

## Logins and server safety (review fixes batch 3, 5 Nov 2026, built)

- **Security of personal information (APP 11):** a signed-in device can
  no longer switch the authenticator off, copy its code, or change the
  password; a password reset emails the owner; sign-ins, wrong codes and
  locks are all recorded (record keeping).
- **Logs:** login and page errors no longer write names, emails, phone
  numbers, licence numbers or sign-in codes into the hosting logs, which
  are kept by a US company (rule 7; APP 8, data sent overseas).
- **Admin access:** the admin site can no longer read the "How to pay"
  bank details businesses type in, as the privacy notes already said, and
  can't change a business's GST status, timezone or Stripe details.
- **Email service's terms:** reset emails are limited to 3 per login an
  hour, so a login's inbox can't be flooded and the shared email account
  isn't put at risk.
- **A paused business:** its Renters can still pay their bond and set up
  their direct debit (the money goes to the business's own Stripe); its
  other links stop. Consumer law: a Renter isn't blocked from paying
  what they owe.

## Signing and documents (review fixes batch 4, 5 Nov 2026, built)

- **What is signed is what was shown (Electronic Transactions Act s 10,
  reliable method; consumer law, unfair terms):** at a handover, return or
  swap the Renter sees the saved kilometres, fuel and keys and the exact
  sentence the report keeps; the swap form is shown in full, with the
  damage found on the car handed back. A fingerprint of what was shown is
  checked under the lock that issues the report; anything changed in
  between is refused, not signed.
- **Signing by typing a name (accessibility, WCAG 2.1.1):** offered on the
  business's phone too; the typed name must be the Renter's own, and the
  report says it was typed.
- **Copies (record keeping, consumer law):** every emailed copy of a fixed
  document is recorded (sent, failed, or no email on file); nobody is told
  a copy went when it didn't, and the business can email it again (the
  same stored PDF, never a new one).
- **Who had the car (record keeping, fines):** possession starting and
  ending is its own line in the history.
- **Font licence:** Noto Sans is under the SIL Open Font License 1.1,
  allowed for fonts by Abhi (5 Nov 2026). It may be embedded in documents
  freely; the licence text is kept with the font files
  (apps/web/assets/fonts/OFL.txt). Nothing to disclose to Renters.
- **Not in this batch:** the signing pages' privacy notice and the other
  privacy items there (A3-9, A3-10, A3-11) come with batch 5.

## Logs

- Error logs (Vercel) hold only the kind of error and, for a database
  error, its code and constraint: never the error's message, which can
  quote the values written (addresses, emails, a password hash). One
  shared helper does this, `describeErrorForLog` in packages/core. The
  privacy policy can say logs contain no personal information beyond
  record IDs.

## Emails

- Sign-in, reset and new-device emails are transactional. The Spam Act
  2003 does not require an unsubscribe link for them. Any marketing
  email later needs consent and an unsubscribe link.

## Libraries used (library swap, 1 Nov 2026)

- Every library added is MIT or Apache-2.0, which allow commercial use. None
  is AGPL or "source available" (ua-parser-js was avoided because it is now
  AGPL). The list with reasons is in docs/plans/library-swap.md.
- Apache-2.0 asks that its licence notice travels with the code. Fuse.js
  (typo suggestions) is Apache-2.0 and is sent to browsers; Playwright is
  Apache-2.0 but only used for testing. A "third-party licences" page or
  file must be in place before launch (docs/launch-checklist.md).
- No library receives personal data: they all run on our servers or in the
  browser. The breached-password check sends only the first 5 characters of
  a fingerprint of the password to Have I Been Pwned, as before.
- A third-party licences file is now generated with each app's build
  (public/third-party-licences.txt, every shipped library with its licence
  and notice files). It still needs a link from the terms or privacy page.
- Test-only tools with other licences, never shipped: axe-core (MPL-2.0),
  LocalStack (Apache-2.0, a Docker image). Build-time and server-only pieces
  under LGPL-3.0 (Next's image resizer, libvips), MPL-2.0 (the CSS compiler)
  and CC-BY-4.0 (browser-support data) are unmodified and not sent to
  browsers, so they place no duty on our code.
- Photos: shrinking on the phone also drops the location details phones
  add to photos, which is good for privacy (APP 11).

## Coming with later features (check when built)

- **Access requests and damage:** "Download everything we hold" does not
  yet list damage records and claims linked to the Renter. Add them before
  launch (also in docs/launch-checklist.md), as they are about the Renter.

- **Identity documents (licence scans):** collect only what is needed,
  and say why in the privacy notice shown to Renters when collected
  (APP 5). Every view is logged (rule 8). Decide retention periods.
- **Retention:** how long Renter data, photos and documents are kept
  after a rental ends, and the scheduled deletion that enforces it
  (rule 13). Tax law needs invoices kept for 5 years.
  Handover and return photos are evidence (damage, insurance claims,
  fines), so decide with the lawyer how long full-size photos must be
  kept; after that, keep only the small copies inside the PDFs, or delete
  them. The clean-up then runs on its own.
- **Direct debit (BECS):** Stripe's mandate wording must be shown and
  accepted; check the DDR service agreement rules before building rate
  changes (already an open item).
- **Fines:** nominating a Renter as driver uses state forms and
  statutory declarations. Check each state's rules before building.
- **Rental contracts:** Operators' own terms, but the platform's
  signing flow must produce a valid electronic signature (Electronic
  Transactions Act 1999). Unfair contract terms law applies to standard
  form contracts.
- **SMS:** the Spam Act applies to text messages too.
- **Renter links:** a Renter never makes an account, so the privacy
  notice has to be shown on the link page itself.
- **Product name:** check PintoFleet is free (ASIC business names, IP
  Australia trade marks, domain). Already an open item.

## Documents we will need

- Privacy policy (PintoFleet, covering Operators and Renters).
- Terms of service for Operators, including a data processing section.
- A privacy notice Renters see when they first open a link.
- A data breach response plan.

## Review fixes batch 5: privacy and records (5 Nov 2026)

- **Retention (APP 11.2), decided 5 Nov 2026:** a Renter's rental and
  money records are kept 7 years after their last rental ended (or after
  they were added, if they never rented). Then a nightly job removes their
  personal details (name, contact, date of birth, addresses, licence,
  emergency contact, notes, submitted forms, link emails, signing evidence,
  typed names) and bins their signed PDFs, reports, invoices, photos and
  licence scans (gone for good 30 days later). Money lines, invoice
  numbers and the history stay as amounts and events. Nothing is removed
  while money is owed either way, a bond is held, a damage matter or claim
  is open, or a booking or car is out. **Lawyer to confirm 7 years before
  launch** (launch checklist).
- **Known limits of the removal, for the lawyer:**
  - free text the business typed into records that are never changed
    stays: a money line's description or reference ("transfer from J
    Smith"), a bond movement's note, a change of terms' reason and a car
    swap's reason (rules 11 and 12). Other free text the business typed
    (rental and checklist notes, cancellation and override reasons, damage
    descriptions, claim notes) is cleared or replaced with "Removed";
  - the Renter's customer record and direct debit on the business's own
    Stripe account are not deleted by us: the business deletes them in
    Stripe if it wants (Stripe keeps payment records for its own legal
    duties).
- **Collection notice (APP 5), one wording everywhere:** on the details,
  signing and payments links; a short line on the business's phone before
  signing; emailed to a Renter added at the counter (a service message
  about their own details, not marketing, so the Spam Act allows it; it
  names the business). Without an email, the business is told to show or
  print it. Wording to be checked by the lawyer.
- **Each business's own privacy policy:** a link in Business details,
  shown in the notice; the template (docs/legal/renter-privacy-policy-
  template.md) now covers proof of signing, direct debits, what emails
  carry and the real keeping times.
- **APP 12 "everything we hold":** now a zip of the full workbook and the
  documents and scans themselves; staff names show as "the business".
- **APP 11 security:** photos never keep where they were taken; browsers
  keep no copy of files opened through view links; the handover phone
  forgets checklists when they end, after 7 days, and at sign-out.
- **Logs:** "How to pay" bank details are no longer written into the
  settings history; the cars list download is logged; a signing-page
  failure never logs the Renter's internet address.

