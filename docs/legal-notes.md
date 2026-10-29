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
- Sign-ins, failed sign-ins and lockouts are recorded in the activity
  log with the time and the kind of device. The privacy policy should
  say what is logged and for how long.

## Stored files (logo built; photos and documents later)

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
- **When Renter lists get exports (Phase 2):** record each export in the
  activity log (who, when, which list and filters), and say in the
  privacy policy and the Operator terms that Operators are responsible
  for what they export.

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
