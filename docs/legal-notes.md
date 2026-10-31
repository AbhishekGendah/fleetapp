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

| Service | What it sees | Where |
|---|---|---|
| Google Places (address lookup) | Address text as it is typed; nothing else | Google, worldwide |
| Have I Been Pwned (leaked-password check) | 5 characters of a scrambled fingerprint of a new password; not personal information, and the password cannot be worked out from it | Run from Cloudflare, worldwide |
| Postmark (email, not yet live) | Names, email addresses, email contents | USA |
| Stripe (payments, not yet built) | Renter names, bank details, payment history | Stripe, incl. USA |
| Vercel (hosting) | Everything passing through the app; functions run in Sydney | US company |
| Neon (database) | Everything stored; data in Sydney | US company |
| AWS S3 (files, not yet built) | Photos and documents; stored in Sydney | US company |
| SMS provider (TBD) | Renter phone numbers and message text | TBD |

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
  Slice 5 deletes scans on a timer after the Renter's last rental.
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
  phone (10 minutes, 5 tries, then the link locks; at most 3 codes an hour).
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
- **The form is kept on the Renter's own phone (browser storage) while they
  type**, licence number included, until they send it; it is ignored and
  removed after the link's end date. On a shared computer someone after them
  could see it if they never send it. Acceptable for now (their own data, on
  a device they chose); revisit if Operators ask Renters to use a shop
  computer.
- **Address search on the link** is limited to 50 per link so a link cannot
  run up the Google bill; Google sees the address text typed (already in the
  overseas table).

## Business details (already built)

- An Operator's ABN, address, phone and email are business information,
  not personal information, unless the Operator is a sole trader. Then
  they are personal and the APPs apply. Treat them with the same care.
- Legal name, ABN, address, phone and email are required. A tax invoice
  must show the seller's identity and ABN (GST law), and the Operator's
  contact details belong on every rental contract. Invoices are built in a
  later phase; this makes sure the details are there when they are.

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

## Coming with later features (check when built)

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
