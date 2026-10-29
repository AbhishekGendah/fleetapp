# Phase 2 plan — Vehicles and Renters

Status: draft, waiting for Abhi's approval. Nothing is built yet.

Phase 2 gives Operators their two core records: cars and Renters. Rentals
(Phase 3) and money (Phase 4) build on them. Five slices, each deployed
and tested on the dev site before the next. Design: docs/design/02 and 03,
plus the Renter links part of 08.

## What is in, and what waits

**In:** cars with their rego, insurance, purchase and sale details,
costs, photos and papers; Renters with their licence and licence scans;
the "do not rent" flag; spotting duplicates; Renters filling in their own
details from a link on their phone; an export of everything held about
a Renter; the scheduled deletion of old licence scans.

**Waits for a later phase, because it needs something not built yet:**
- Car status "rented" and the booking checks (age, licence class,
  provisional, expiry blocking handover): need rentals (Phase 3).
- Profit per car: needs income from the ledger (Phase 4). Costs are
  recorded now, so the report has the data when it arrives.
- Servicing schedules and reminders by email: Phase 5. Phase 2 shows
  "expires soon" badges on screen only.
- Renter's balance, bond and fines on their history screen: Phases 3–6.

## Slice 1 — Cars

Goal: an Operator can add, find, edit and archive their cars.

- **Car record:** rego, rego state, VIN, make, model, variant, year,
  colour, body type, transmission, fuel type, seats.
  - Rego is stored in capitals without spaces, so "1ABC 234" and
    "1abc234" are the same car. VIN: 17 letters and numbers (never
    I, O or Q).
  - The same rego in the same state cannot be added twice by one
    Operator (enforced by the database), unless the old car is archived.
- **Make and model from a built-in list** of cars sold in Australia,
  kept as a data file in packages/core (no database table, no admin
  screen). Choose the make, then a model from that make's list; both
  boxes are searchable. "Other" opens a free-text box for anything
  missing.
  - The car stores the make and model as text, not a link to the list,
    so editing the list later never changes or breaks an existing car,
    and "Other" cars sit alongside the rest.
  - Tradeoff: adding a new model means a small code change and deploy.
    Fine while AGS curates the list; an admin screen can come later.
  - The list is compiled by AGS from public information (car names are
    facts, not anyone's property); no paid data provider. Variant
    (e.g. "Ascent Sport Hybrid") stays a typed box: too many to list.
  - Needs a new shared piece: a searchable dropdown, added to
    packages/ui and the catalogue first (rule 29).
- **Status:** available, in service, off road, sold, written off.
  "In service" and "off road" need a reason and an expected return date.
  "Rented" arrives in Phase 3 and is only ever set by the system.
- **Odometer readings** (a small table now, because purchase and
  manual readings start here; handovers add theirs in Phase 3). A reading
  lower than the last one is flagged, not refused. The setting to turn
  that flag off comes in Phase 5 with the rest of servicing.
- **Screens:** the cars list (shared list: search by rego, make, model;
  filter by status; export), add/edit form (live checks, asterisks), the
  car page with tabs, and a History tab from the activity log.
- **Archive** instead of delete (rule 13). Sold and written-off cars can
  be archived; they keep their history.
- **Lists page in the database from here on:** the shared list's rules
  (search, filter, sort, pages) get a database version, so a fleet of
  any size loads one page at a time. Admin's Operator list moves to it too.
- Setup checklist step "Add your cars and Renters" ticks once the
  Operator has at least one car and one Renter (after slice 3).

## Slice 2 — Car paperwork, costs, photos

- **Rego:** one record per renewal: state, term (3, 6 or 12 months),
  expiry date, cost, paid date, the rego paper. The latest one is "the"
  rego; the car page and list show a badge when it is due soon or
  expired.
- **Insurance policies:** insurer, policy number, type (comprehensive or
  third party), start, end, excess, cost, certificate. One policy can
  cover many cars (fleet policies), and a car can move between policies.
  Same badge for "due soon / expired".
- **Purchase:** date, price, GST, bought from a dealer or a private
  seller (a private sale has no GST to claim back), seller, odometer at
  purchase (saved as the first reading).
- **Other costs** (refurb etc.): date, description, amount, GST, receipt.
- **Sale:** date, price, buyer; sets the status to sold.
- **Money rules:** every amount is whole cents with its GST stored
  separately (rule 9). These are the Operator's own expenses, not the
  Renter ledger; edits are allowed and logged with before and after.
- **Photos:** resized on the phone before upload (about 1600px) plus a
  small copy for lists (rule 21); several at once; uploads queue if the
  signal drops and retry.
- **Documents:** PDFs or images (rego papers, insurance, purchase
  papers, inspection reports).
- **Settings added (with their screen):** "due soon" for rego and
  insurance, 30 days by default.

## Slice 3 — Renters

Goal: an Operator can add Renters, with licence details and scans, kept
private.

- **Renter record:** full name, preferred name, date of birth, phone,
  email, home address (with the Google lookup), postal address, emergency
  contact (name, phone, relationship), and dated private notes.
- **Licence:** number, issuing state or country, class, expiry, type
  (full, provisional, overseas), front and back scans. No card number
  (decision 1).
- **Scans** go in the separate identity bucket (rule 8). Shown only
  through links that expire in minutes, and every view is written to the
  activity log with who looked. Never shown on any Renter link page.
- **Status:** active, do not rent (with a reason, private to the
  Operator), archived. Never shared between Operators.
- **Duplicates:** the same licence number from the same state, or the
  same email, shows "this Renter already exists" with a link to them. The
  licence check is also enforced by the database, including archived
  Renters, so a returning Renter is brought back rather than entered
  twice.
- **Licence expiry badge** on the list and page. Setting: warn 30 days
  before (with its screen).
- **Export everything held about a Renter** as one Excel file, one sheet
  per section, for a Renter who asks what is held about them (privacy
  law gives them that right). The export is logged.
- **History tab** from the activity log.
- **Admin cannot see Renters at all:** the admin database login gets no
  access to any Renter table (rule 5). A test proves it, alongside the
  usual "Operator A cannot read Operator B's Renters" tests.

## Slice 4 — Renter links and self-onboarding

Goal: the Operator sends a link; the Renter fills in their details and
photographs their licence on their phone; the Operator checks and
approves.

- **The Operator starts it:** they add the Renter's name and email (or
  phone), then press "Send details form". The link belongs to that
  Renter, so nobody can use it to create Renters out of thin air.
- **The link** (rule 26): only a fingerprint (hash) of it is stored; it
  is for this one purpose only; it expires (7 days by default); the
  Operator can cancel or resend it.
- **One-time code on a new device:** the first time the link is opened
  on a phone, a 6-digit code is emailed to the Renter (10 minutes, 5
  tries). That phone is then remembered for this link.
- **The form**, phone-first: the details from slice 3, plus the licence
  photos taken with the phone's camera. The privacy notice is shown at
  the top (who is collecting, why, who it is shared with), naming the
  Operator.
- **Nothing changes until the Operator approves.** The Renter's answers
  wait as a submission; the Operator sees them next to what is already
  on file and approves (copied in, logged as from the Renter's link) or
  sends it back with a note.
- **How the link finds its Operator without a sign-in** (rule 3): one
  narrow database function turns a link fingerprint into its Operator and
  link ID, and nothing else; everything after that runs inside that one
  Operator's data only, as in the file clean-up job.
- **Email:** in dev the code and link land in the dev outbox. Real Renter
  emails need Postmark set up first (a go-live item, already open). The
  Operator can also copy the link and send it themselves (e.g. by text).

## Slice 5 — Retention

- **Scheduled deletion of licence scans** 12 months (a setting) after a
  Renter's last rental closes, or after they were archived if they never
  rented, unless a fine or dispute is open (those arrive later; the check
  is written so they plug in). The scans go to the 30-day bin, then are
  purged (rule 23). Name, licence number and records stay (tax: 5 years).
- Runs inside the existing daily clean-up, safe to re-run.

## Not in Phase 2 (offered as Phase 2b, decide later)

- **Spreadsheet import** of cars and Renters (template, preview, errors
  shown before saving, safe to re-run). Useful for an Operator moving
  from spreadsheets; it is its own small slice once the records exist.

## Decisions in this plan (pushed back on easily)

1. **No licence card number** (decided by Abhi). The design lists it, but
   it is only needed for checking licences against government records (a
   later version), and privacy law says collect only what you need. The
   licence number, state, class, expiry, type and both scans are kept.
2. **The self-onboarding link is always for a Renter the Operator has
   already started.** Tradeoff: one extra step for the Operator (typing a
   name and email first), in return for no anonymous sign-ups and no spam.
3. **Licence numbers are stored as plain text** (protected by database
   encryption at rest, row-level security and no admin access), not
   scrambled per field. Tradeoff: simpler and searchable; a database leak
   would expose them, which per-field scrambling would limit. Worth
   revisiting with the lawyer before go-live.
4. **Make and model come from a built-in list** (decided by Abhi), with
   "Other" for anything missing. See slice 1.

## Safety checks for every slice

- Every new table: `operator_id` required, row-level security forced,
  "Operator A cannot read Operator B" tests, every change in the
  activity log.
- Dates that are just dates (rego expiry, date of birth, licence expiry)
  are stored as dates, not times, so they never shift a day with
  timezones.
- New files follow the existing upload checks (type from content, size
  caps, private buckets).
- Each schema change is its own migration, backwards compatible.

## Legal side (also added to docs/legal-notes.md when built)

- Renters' personal information starts being collected here. Before the
  first real Operator: the Renter privacy notice wording, the privacy
  policy, and the Operator terms (who is responsible for what).
- Private notes and "do not rent" reasons can be asked for by the Renter
  (privacy law gives them access to what is held). The notes screen will
  say "write facts only; the Renter can ask to see this".
- Licence scans and dates of birth are high-risk if leaked: separate
  bucket, every view logged, scheduled deletion (slice 5).
- No shared blacklist between Operators: "do not rent" stays with the
  Operator that set it.
- Renter emails (codes, links) are transactional; no unsubscribe needed,
  never used for marketing.
