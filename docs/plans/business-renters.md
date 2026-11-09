# Business Renters

Status: **approved by Abhi, 7 Nov 2026 (all 11 decisions and both rule
wordings).** Mockups next; each slice still gets his go before it is built.
It touches schema, money, signing and tenancy, so CLAUDE.md
asks for a plan first. Source: qol-suggestions O1 (Abhi's friend, 6 Nov).
Design docs read: 03 (Renters), 04 (Rentals), 05 (signing and handover), 06
(money), 07 (fines). Rules 9 to 20, 26, 28 and 31 apply throughout.

---

## What this means for you

- A Renter can now be a **person** (as today) or a **business** (a company,
  partnership or trust renting several cars, e.g. for its rideshare drivers).
- A business has its legal name, trading name, ABN, address and a contact
  person (name, email, phone) who gets the invoices and signs for it.
- Every car a business rents has a **driver**: a real person with a checked
  licence. The driver is who signs for the car at pickup, so if a fine comes
  in later, the app knows exactly who had the car at that moment.
- The business pays: one direct debit from its bank account covers all its
  cars, each car has its own bond, and each car's money stays on its own
  rental, exactly as today. The business's page adds it all up, and you can
  send it **one statement across all its cars**.
- Invoices go to the business, with its ABN on them (so it can claim the
  GST back), and show the car and driver they are for.
- Drivers are kept as ordinary person Renters, labelled "Driver for Acme".
  A driver who also rents a car on their own is the same record, so their
  licence is checked once and "Do not rent" follows them everywhere.
- Nothing changes for your existing Renters: they all become "person"
  Renters automatically and work exactly as before.
- It is built in five small steps, each shown to you on the dev site before
  the next. You see drawings (mockups) of the new screens before any are built.

### Decisions you need to make

Each has my recommendation and the main tradeoff. Say yes, or push back on
any of them.

1. **Drivers are person Renters, not a separate list.** Recommend: yes.
   Tradeoff: drivers show in your Renters list (with a "Driver" label and
   filter); in return one licence check, one details form and one set of
   privacy rules covers everyone, and a driver who later rents on their own
   is already on file.
2. **When the driver must be named: before pickup, not at booking.**
   Recommend: a booking may say "driver to be named"; the handover can't
   start until one is named and passes the licence checks. Tradeoff: licence
   problems may show up later than at booking; in return a fleet can book
   cars before it has decided who drives them.
3. **Who signs what.** Recommend: the business's contact (who must tick "I am
   authorised to sign for this business") signs the contract and any change
   of terms by link; the driver signs at pickup, return and swap on your
   phone. Tradeoff: two people are involved; in return the business is bound
   by the contract and the driver's signature proves who had the car.
4. **Changing the driver during a rental needs the car brought in.**
   Recommend: a quick check-in and check-out on your phone, the new driver
   signing for the car. Tradeoff: the business has to bring the car to you;
   in return the record of who had it never has a gap or a guess (this is
   what fines depend on).
5. **One driver per car at a time; no shift-sharing.** Recommend: the app
   records one named driver; the business contract makes the business
   responsible for anyone else who drives and for naming them on a fine.
   Tradeoff: a fleet running day and night shifts on one car must handle the
   second driver itself; in return the app never pretends to know who drove
   when it doesn't.
6. **One weekly debit per car (not one combined debit).** Recommend: per
   car. Tradeoff: the business sees several debits a week and Stripe charges
   its fee on each (BECS fees are capped per debit, so one big debit can be
   cheaper); in return a failed or disputed debit affects one car only, and
   it matches the weekly debits plan already drawn up. A combined debit can
   come later.
7. **Invoices: one per car per week, plus a business-wide statement.**
   Recommend: yes, each invoice addressed to the business with its ABN and
   showing the rego and driver. Tradeoff: a fleet gets many invoices; in
   return invoice numbers, corrections and GST stay exactly as proven today.
   A combined weekly invoice can come later.
8. **Sole traders (most rideshare drivers have an ABN) stay person
   Renters**, with an optional ABN box printed on their invoices.
   Recommend: yes. Tradeoff: one more box on the person form; in return a
   one-person business isn't forced to have a "driver" who is themselves.
9. **ABN check: the maths check now, the government lookup later.**
   Recommend: the checksum (instant, already used for your own ABN) now; the
   free government ABN Lookup (is the ABN active, whose is it, GST
   registered?) as its own small step later. Tradeoff: a well-formed but
   wrong ABN gets through until then.
10. **A separate "Business rental contract" template.** Recommend: yes, you
    write it (we provide the layout, the lawyer checks the words). Tradeoff:
    one more template to keep; in return a person's contract never prints
    "[not on file]" where a date of birth would be.
11. **You enter the business's details; drivers fill in their own.**
    Recommend: the business's details are typed by you (from a phone call or
    email); each driver gets the existing details link to add their own
    licence and photos. Tradeoff: no self-service form for the business yet;
    in return no new kind of link is needed now.

Two lines of CLAUDE.md need your approval too (they change rule wording, see
"Rule wording" below): rule 15 (for a business, the driver signs for the
car) and the Terminology list (adds "Driver").

---

## Technical detail (for the builder)

### What the code does today (findings)

- `renters` is person-shaped: licence columns, date of birth, emergency
  contact, a unique licence index per Operator (archived included), status
  `active | do_not_rent`, `retired_at` set only by the retention job. Column
  `UPDATE` grants are listed one by one (0018 onwards); admin has none.
- `rentals.renter_id` is used for two different meanings at once: **who pays
  and is party to the contract** (ledger via rental, invoices, payments,
  mandates, bonds, signing links, documents emailed) and **who drives**
  (booking licence checks, handover locks, `possessions.renter_id`, damage
  "holder", licence scan retention, the 7-year retirement clock).
  About 30 files read it (`grep -rn "rentals.renterId"`); each is sorted
  into one of those two meanings in slice 1.
- Money is already per rental: `ledger_lines`, `billing_documents`,
  `bond_movements`, `payments` all carry `rental_id`; a Renter's Owing is
  summed over their rentals (`lib/renters/renter-money.ts`), and overdue is
  worked out per rental. So a business's totals across cars need **no
  ledger change**.
- `payment_mandates`: one active per Renter; `renter_stripe_customers`: one
  per Renter. Both fit "the business pays" with no change.
- `possessions` has `renter_id`, a handover inspection (NOT NULL), and the
  per-car exclusion rule. Swaps close one and open another.
- Statements are `issued_documents` of kind `statement`, **per rental**
  (`rental_id NOT NULL`). A business-wide statement needs a Renter-scoped
  issued document.
- Retention (0047): `renter_records_kept_until`, `retire_renter` and the
  scan retention holds look only at `rentals.renter_id`. A driver with no
  rentals of their own would be retired 7 years after being *added*, even
  while driving a business car: a real bug if left unchanged.
- In code and UI copy, "business" already means **the Operator** (Settings
  → Business details, `document_emails.recipient = 'business'`, many
  comments). Using "business" for a Renter kind in code would be ambiguous.
- Fines are not built (Phase 6); this plan only makes sure the data they
  need is there.

### Data model

Recommendation: **one `renters` table with a `kind`**, and **drivers are
person rows in it**, linked to a business by a small link table.

Why drivers are rows in `renters`, not a new table:
- Everything a driver needs already exists for person Renters: licence
  columns and their checks, licence scans (`files.renter_id`, identity
  storage, signed URLs, view logging), the details link and review,
  duplicate detection by licence, Do not rent, archive, the privacy notice,
  "Download everything we hold", and the 7-year retirement. A new table
  would copy all of it (rule 30) and need its own RLS, retention and export.
- A driver who also rents on their own is **one record**: the unique licence
  index guarantees it, so Do not rent and licence checks can't be dodged by
  being entered twice.
- `possessions` and `damage_records` already point at `renters`.
- Cost: lists must label and filter drivers; the Terminology note in
  CLAUDE.md gains "Driver: a person Renter who drives for a business Renter".

Code words (terminology): `renter_kind` enum `person | organisation`. UI
says "Person" and "Business". `organisation` avoids clashing with the
existing use of "business" for the Operator. Never "client", "customer" or
"tenant".

#### Migration A (slice 1), on a filled database, backwards compatible

Every step works with the code already deployed (migrations don't block the
deploy; progress.md "Open items").

1. `CREATE TYPE renter_kind AS ENUM ('person', 'organisation')`;
   `ALTER TABLE renters ADD kind renter_kind NOT NULL DEFAULT 'person'`.
   A constant default fills every existing row at once (no table rewrite
   on Postgres 11+): **the backfill of existing Renters as person**.
2. New nullable columns on `renters`: `trading_name`, `abn` (11 digits,
   stored without spaces), `contact_name` (the billing contact; `phone` and
   `email` are the contact's, so `renters_has_contact` still holds; an
   organisation must have an `email`: check `renters_organisation_email`,
   and the same rule in Zod),
   `business_address`. `phone`, `email`, `postal_address`, `status`,
   `do_not_rent_reason`, `archived_at`, `retired_at`, `full_name` (the
   **legal name** for an organisation) are shared.
3. Checks:
   - `renters_kind_fields`: a person has no `trading_name`,
     `contact_name`, `business_address`; an organisation has no date of
     birth, preferred name, home address, emergency contact or licence (all
     null, so the licence index never sees it).
   - `renters_abn_shape`: `abn is null or abn ~ '^[0-9]{11}$'` (checksum
     in Zod on the form and again on the server, rule 31; a plpgsql
     checksum function in the database too, since it's cheap and stops a
     bad import).
   - Person `abn` allowed (decision 8). Not unique: two branches can share
     an ABN; a same-ABN warning is shown like the same-email note.
4. Grants: `UPDATE (trading_name, abn, contact_name, business_address)` to
   `web_app_role`. **No update grant on `kind`**: a Renter's kind is fixed
   at creation (a wrong one with no rentals is archived and added again;
   changing it would change the meaning of every rental and document).
   Admin roles get nothing (rule 5).
5. New table `organisation_drivers` (which people drive for which business):
   `id`, `operator_id NOT NULL`, `organisation_id`, `driver_id`,
   `added_at`, `added_by_user_id`, `removed_at`, `removed_by_user_id`,
   timestamps. Two-column FKs to `renters (id, operator_id)` for both.
   Partial unique `(operator_id, organisation_id, driver_id) where
   removed_at is null` (a driver can be removed and added back; history
   kept). Check `organisation_id <> driver_id`. Trigger: the organisation
   must be `kind = organisation`, the driver `kind = person`, neither
   retired. RLS **enabled and forced**, tenant policy as every other table,
   `GRANT SELECT, INSERT, UPDATE (removed_at, removed_by_user_id,
   updated_at)`; nothing for admin; the structural tenancy test covers it.
   Never deleted (rule 13).
6. `rentals.driver_id uuid` (nullable), FK `(driver_id, operator_id)` →
   renters, index `(operator_id, driver_id)`. Backfill
   `UPDATE rentals SET driver_id = renter_id` (every existing Renter is a
   person). Check `rentals_driver_when_out`: status in `active, returned,
   closed` ⇒ `driver_id is not null`. Grant `UPDATE (driver_id)`.
   Trigger `rentals_driver_rules` (BEFORE INSERT OR UPDATE OF renter_id,
   driver_id):
   - Renter is a person: `driver_id` defaults to and must equal
     `renter_id`. (This default is what keeps the old deployed code
     working: it inserts rentals without a driver.)
   - Renter is an organisation: `driver_id` is null (draft or booked only)
     or a person with a current `organisation_drivers` row for that
     organisation, not retired. Archived or Do not rent are app checks
     (with messages), the same as for the Renter today.
   - Extends `rentals_not_for_retired_renters` to the driver.
   - While the rental has an open possession, `driver_id` may change only
     to the driver of a possession opened in the same transaction (the
     driver change of slice 4); any other edit is refused, so the rental and
     its possession never disagree.
7. `possessions.driver_id uuid`: add nullable, backfill `= renter_id`, then
   `SET NOT NULL`; FK to renters; index `(operator_id, driver_id,
   started_at)` for "this driver's time with cars". Trigger on insert: if
   null, fill from the rental's `driver_id` (old code keeps working); it
   must equal the rental's `driver_id` at that moment. `possessions.renter_id`
   keeps meaning **the rental's Renter** (the hirer), unchanged. Fine
   matching reads `driver_id` and `renter_id` from the possession, **never
   the rental's current driver** (a fine for an old rental must name who had
   the car then).
8. Retention functions replaced (new migration, never editing 0047):
   - `renter_records_kept_until`: the latest of created, own rentals'
     created/returned/cancelled, **and possessions where they were the
     driver** (ended_at), **and** `organisation_drivers.removed_at`.
   - `operators_with_renters_to_retire`, `retire_renter`: "nothing open"
     also means no draft/booked/active rental naming them as driver and no
     current `organisation_drivers` row. The scan retention holds
     (`retention-holds.ts`) count rentals by `driver_id` (the licence is the
     driver's).
   - What a retirement removes, per rental: the free text and PDFs of a
     business rental hold both the business contact's and the driver's
     details. Rule: a rental's personal records (inspection typed names,
     handover/return/swap PDFs and photos) are binned only once **both** its
     Renter and every driver who had it are past their 7 years. Retiring a
     driver blanks their own row and links; retiring the business blanks its
     row (contact name, phone, email, addresses). Money lines, invoices and
     statements stay (tax records).

#### Migration B (slice 5)

- `issued_documents.renter_id uuid` (nullable, FK to renters) and
  `rental_id` made nullable, with check: exactly one of them is set, and
  `renter_id` only for kind `statement`. A version unique for Renter
  statements `(operator_id, renter_id, kind, version)`. Existing rows all
  have `rental_id`, so nothing changes for them. Every query that joins
  `issued_documents` to `rentals` is checked (inner joins still right; a
  Renter statement is listed on the Renter page only).
- ~~`document_emails.recipient` gains `'driver'` (check widened).~~ Pulled
  forward on Abhi's go (8 Nov 2026) as `0056_driver_document_copies`, with
  the driver's own copies (see "As built (slice 3)"); Migration B is now the
  Renter statement change only.

#### Migration C (slice 4, driver change)

- `rental_driver_changes`: `rental_id`, `from_driver_id`, `to_driver_id`,
  `reason`, `status` (in_progress, completed, cancelled), the return
  inspection (old driver; may be absent) and the handover inspection (new
  driver signs), `changed_at`, `started_by_user_id`. One in progress per
  rental; none while a swap is in progress (and the reverse). Same shape
  and protections as `car_swaps`.
- `inspections.is_for_driver_change boolean NOT NULL DEFAULT false`, and the
  `inspections_one_completed` partial index widened to exclude it too.
- The change completes in one transaction under the rental lock: old
  possession `ended_at = changed_at`, new possession opened at the same
  instant with the new driver (the `[)` ranges meet, so the per-car
  exclusion rule holds), `rentals.driver_id` updated, logged.

### How each flow changes

| Flow | Person Renter | Business Renter |
|---|---|---|
| Add Renter | as today | "Person or business?" first; business form: legal name*, trading name, ABN (formatted 2-3-3-3 as typed, checksum), contact name*, contact email* (Abhi, 7 Nov: required, as the contract, invoices and statements go by email), contact phone, business address (address lookup), postal address |
| Details link | as today | not offered for the business (decision 11); offered to each driver as today |
| Drivers | none | Drivers tab: pick an existing person or add one (name and phone or email), then send them the details link; remove (refused while named on a booked or out rental) |
| Booking | as today | pick the business, then its driver or "to be named" (decision 2). Checks split: Renter checks (Do not rent, business details complete: legal name, ABN, address, contact) and driver checks (today's licence, age, class, provisional, expiry, scans, Do not rent, archived). Warning (not refusal) if the driver already has another car out |
| Contract | as today | sent to the contact's email; the "Business rental contract" template (new merge fields: business Renter's legal name, trading name, ABN, address, contact, signer's name and position; no driver fields, as drivers change). Signer types name and position and ticks "I am authorised to sign for [legal name]"; stored in `signing_evidence.details` and printed on the certificate page |
| Direct debit and bond | as today | the payments link goes to the contact; the mandate and Stripe customer are the business's (one for all its cars); bond per rental |
| Handover | Renter signs | the driver signs; acceptance text: "I, [driver], received [rego] for [business] at [time] …"; possession starts with `driver_id` = the driver (rule 15). Locks Renter and driver |
| Return / swap | as today | the driver signs (or absent, as today); swap form signed by the driver; copies to the driver and the business contact |
| Change of terms | Renter signs by link | the business signs by link (it's a contract change) |
| Driver change | n/a | slice 4 (decision 4) |
| Invoices, receipts | as today | addressed to the legal name and ABN; each shows rego and driver name; emailed to the contact |
| Statement | per rental (as today), plus a new Renter-wide one | one across all its rentals for any dates, grouped by car with subtotals |
| Damage | holder from the rental | `renter_id` = the business (who is charged); who had it comes from the possession's driver, shown on the damage page |
| Do not rent | as today | on the business: no new bookings for it; its drivers are untouched (marked separately if needed). On a driver: they can't be named for any business or rent on their own |
| Archive | refused while booked/out | refused while it has booked/out rentals or current drivers; an archived driver is refused as a new driver, stays on old rentals |
| Everything we hold | as today, plus rentals they drove (possessions, reports they signed, damage linked to them), not the business's money | the business's details, drivers' names per rental, all its rentals' money and documents; never drivers' licences or dates of birth |
| Retention | 7 years (now counting driving) | 7 years after its last rental; see Migration A step 8 |
| Fines (Phase 6) | match possession | possession gives driver and business; nominate the driver by default, the business if the driver disputes. Phase 6 decides with the lawyer |

Required fields use `isRequired` and `RequiredFieldsNote` (rule 28); the
form is checked as typed with the server's Zod schema. Formatting (rule 31):
ABN uses the existing `formatAbn` box, phones and postcodes their
formatters; legal and trading names are free text (no format fits a
business name: said here as rule 31 asks).

### Screens (mockups first, rule 34)

Mockups in the approved look, phone and computer, before building:
1. Renters list: a kind label (Business, Driver for Acme), filters gain
   **Businesses** and **Drivers**; business cards show cars out and Owing.
2. New Renter pop-up with the Person or Business choice.
3. One business Renter's page: navy strip (trading name, legal name and
   ABN, Call/Text/Email the contact; facts: Owing across cars with days
   late, Cars out, With you since). Tabs: Overview, Drivers, Rentals,
   Money, Details, Notes, Log.
4. A driver's page: as a person, plus "Drives for" (current and past
   businesses) and "Cars driven" from possessions.
5. New rental: Renter picker, then the driver picker (that business's
   drivers, with licence status; "To be named"; "Add a driver").
6. One rental's page: the strip shows "Acme Pty Ltd · driver Sam Lee"; Next
   step says "Name a driver" when needed.
7. Driver change flow on the phone (slice 4).
8. The business statement PDF.

Rentals list, Needs attention and header search: the Renter column shows
the business with the driver under it; search finds legal name, trading
name, ABN (spaces ignored), and drivers. Needs attention keeps one item per
rental (each has its own debit), named "Acme · ABC123".

### Money correctness

- The ledger stays per rental and append-only (rule 11). No new balance is
  stored; the business's Owing and statement are sums of its rentals'
  lines (`ledgerBalanceCents`, `statementFigures`).
- Overdue is per rental, so credit on one car never hides another car's
  arrears (as today).
- GST: unchanged per charge type and per line (rule 9). The business
  claiming GST credits is why its ABN is printed.
- Invoice numbers: unchanged sequence per Operator (rule 17); the business
  statement is not a tax invoice and takes no number.
- Idempotency (rule 20): unchanged; weekly charge and debit remain per
  rental per period.
- Payment method remains a type (rule 16).

### Tests

- Database: backfill (every existing renter `person`, every rental and
  possession `driver_id = renter_id`), on the demo-filled database CI uses.
  Triggers: a person rental's driver must be the Renter; an organisation's
  driver must be its current driver, a person, not retired; a handover can't
  complete without a driver; a possession's driver equals the rental's.
  Kind can't be updated (no grant). Checks refuse a licence on a business.
- **Tenant isolation**: Operator A can't read B's `organisation_drivers`,
  can't name B's person as a driver (composite FK and trigger), and A's
  business statement holds only A's lines.
- Retention: a driver who only drives business cars isn't retired while
  driving or within 7 years of their last possession; a business's PDFs
  aren't binned while one of its drivers is still in time.
- Money: business Owing = sum of its rentals' balances to the cent; the
  statement's totals equal its lines; one rental overdue while another is
  in credit still shows overdue.
- Possession: a driver change closes and opens at one instant; a fine-style
  "who had this car at T" lookup returns the old driver for a time before
  the change and the new one after; a swap for a business keeps the driver.
- Browser (rule 33): each new or changed screen at phone width, keyboard
  only, axe (WCAG 2.2 AA), download budget.

### Legal (to docs/legal-notes.md as each slice lands)

- **Tax invoices**: the ATO wants the buyer's identity or ABN on a tax
  invoice of $1,000 or more (GST-inclusive); we always print the legal name
  and ABN. ([ATO, tax invoices](https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices);
  [Airwallex summary](https://www.airwallex.com/en-au/blog/tax-invoice-requirements).
  The ATO site can't be fetched from this session; checked through search.)
  Ask the accountant: is the legal name or trading name the right buyer
  identity, and does a driver name on the invoice matter?
- **ABN checksum**: the ATO's weighting (10, 1, 3 … 19, first digit less 1,
  divisible by 89), already in `packages/core/src/abn.ts`. Checksum only
  proves the shape. The government ABN Lookup web service (free, needs a
  registered GUID; its terms ask that results not be shown as the
  government's own) is decision 9's later step.
- **Privacy (APPs)**: drivers are individuals: collect from them directly
  (APP 3.6) through their details link; each gets the privacy notice (APP
  5), which must say that their name, signature and the car's use are shared
  with the business they drive for. The business never receives a driver's
  licence, date of birth or address through the app. A business's contact
  details are personal information too (and a sole-trader-style business
  name can be a person's name): same handling, never logged (rule 7), no
  admin access (rule 5). Overseas disclosure unchanged (Stripe).
- **Consumer law**: a business renting for under $100,000 still gets the
  consumer guarantees; standard-form contracts with a small business (fewer
  than 100 employees or under $10 million turnover) fall under the unfair
  contract terms law, with penalties since Nov 2023. The business contract
  (indemnity for other drivers, naming drivers on fines, bond deductions)
  needs the lawyer. ([ACCC, contracts](https://www.accc.gov.au/business/selling-products-and-services/contracts);
  [MinterEllison](https://www.minterellison.com/articles/unfair-contract-terms-reforms))
- **Ask the lawyer**: (1) a long or ongoing hire of a car to a company can
  be a "PPS lease" under the Personal Property Securities Act; without a
  PPSR registration the Operator may lose the car if the company goes broke.
  Recommend the Operator's terms and onboarding say so (launch checklist).
  (2) Whether to ask a company's director for a personal guarantee (out of
  scope here). (3) Electronic signing by an "authorised person" for a
  company (Electronic Transactions Act: identifying the signer and their
  authority).
- **Spam Act**: invoices, statements, links and reports to the business
  contact and to drivers are transactional (they identify the sender; no
  unsubscribe needed). No marketing.
- **Record keeping**: invoices and statements kept 5 years at least; never
  touched by retention.
- **Rideshare**: ride-sourcing drivers must be registered for GST (ATO),
  which is why decision 8's optional ABN on person Renters matters.

### Slices (each small, reviewed, on the dev site before the next)

1. **Foundations, no visible change.** Migration A; every `rentals.renter_id`
   use sorted into "payer" (stays) or "driver" (now `driver_id`); booking
   checks split into Renter and driver checks in `packages/core`; retention
   fixed for drivers. Person Renters behave exactly as before. Deep review
   (tenancy, possession), two checkers.
2. **Business Renters and their drivers.** Add/edit a business, Renters list
   labels and filters, business page and tabs, Drivers tab, driver's
   "Drives for", search, export, everything we hold, Do not rent and archive
   rules. Mockups 1 to 4 first. Quick review plus tenancy tests.
3. **Renting to a business.** Driver picker, "to be named", contract
   template kind and merge fields, authorised signing, payments link to the
   contact, handover/return/swap signed by the driver, emails to driver and
   business. Mockups 5 and 6 first. Deep review (signing, possession).
4. **Changing the driver.** Migration C, phone flow, possession change.
   Mockup 7 first. Deep review.
5. **Business money documents.** Invoices addressed to the business with
   ABN, rego and driver; Migration B; business-wide statement; Money tab
   across cars; Owing on the strip. Mockup 8 first. Deep review (money).

#### As built (slice 1, 7 Nov 2026)

Abhi's go: 7 Nov 2026. No screen changed; person Renters behave as before.

- **Migrations.** `0052_business_renters` (steps 1 to 7) and
  `0053_driver_retention` (step 8). Both ran on the demo-filled database CI
  builds from main (40 Renters, 37 rentals, 18 possessions: all backfilled,
  every Renter a person), and a test (`business-renters-update.test.ts`)
  runs them on a database filled at 0051, then inserts a rental and a
  possession the way the deployed code does (no driver) and sees the driver
  filled in.
- **Added beyond the plan** (each tested): a possession's `renter_id` must be
  the rental's Renter; a finished (returned, closed, cancelled) rental's
  driver never changes; a deferred check at commit that a car out is with
  the rental's driver by an open possession; `organisation_drivers` times are
  stamped by the database (they start the seven-year clock), a removed link
  is kept as it is, and deletes are refused even for the owner; a current
  link holds back the retirement of both the driver and the business, and a
  link's end counts for both.
- **Driver change order (for slice 4).** A possession must name the rental's
  driver when it starts, so the change runs: end the old possession, change
  `rentals.driver_id` (allowed only while no possession is open), start the
  new driver's possession, all in one transaction. The commit check refuses
  a car out with no possession for its driver. This is what the plan's
  "a possession opened in the same transaction" means in practice.
- **Booking checks.** `renterProblems` and `driverProblems` in
  packages/core; `bookingProblems` composes them, saying Do not rent once.
  For a business with no driver named, the app finds no booking parties and
  the database refuses a car going out; the "Name a driver" problem, its
  wording, and the archived-driver message come with slice 3.
- **Retention.** A rental's typed names, notes, checklist photos and issued
  PDFs are binned only once its Renter and every driver are retired. A
  damage record is the payer's (the business's), so its description goes
  with the business, as before for a person. The existing protections still
  let the owner edit a rental's records once its Renter is retired; only
  `app.retire_renter` runs as the owner, and it applies the all-parties rule.
- **Locks.** A possession starting locks its rental (shared), so the driver
  can't change under it; naming a business's driver locks the driver and
  the link (shared); a link locks both Renters (shared); retirement locks the
  Renter, then every rental they rent or drive. Seen while reviewing, not
  changed: booking a draft locks the rental and then the Renter, while the
  retirement locks the Renter and then their rentals; Postgres would end one
  of the two if they ever met (the job tries again the next night).

**Deep review fixes (7 Nov 2026, both checkers).** Made in 0052 itself, which
had not run on any shared database (no 0054):

- **F1** A rental that is returned, closed or cancelled, or becomes so in
  the same statement, never changes driver; the commit check also holds a
  returned or closed rental to the driver of its last possession, so no
  change slips in between the possession ending and the return.
- **F2** A driver's link can't be removed while a draft, booking or car out
  of that business names them, and a business's car goes out (a possession
  starts) only to a current driver of its. The link row is where the two
  meet: removing it locks it, naming a driver and starting a possession
  take it shared, so neither the business nor the driver is locked by the
  removal and the booking's order (business, driver, link) is never
  reversed. The Drivers tab (slice 2) locks the business and the driver
  before the link, in that order.
- **F3** A person with a current driver link, or a business with one, can't
  be archived, and an archived Renter can't be given a link. The database
  refuses it; the friendly messages come with the Drivers tab (slice 2).
- **F4** Tests run two transactions at once on a link and the retention job,
  a possession and a driver change, and naming a driver and removing the
  link, each in both orders.
- **F5** The handover locks the Renter, the driver and then the rental, and
  refuses as "changed" when the rental now names another driver than the
  page showed, instead of a database error. A car swap needs no such check:
  the driver can't change while a possession is open.
- **For slice 3:** the handover (and swap and return) signature's typed name
  is checked against `view.renterFullName`; for a business rental it must
  be the driver's name.

**Each use of `rentals.renter_id`, sorted.**

Now the driver (`driver_id`): booking licence, age, details and scan checks
(`booking-checks.ts`, the driver row locked after the Renter); the handover
lock (`complete-handover.ts`, Renter then driver); the possession's driver at
a handover and a swap (`possession-records.ts`, `complete-swap.ts`,
`handover-queries.ts` carries it); licence-scan retention holds
(`retention-holds.ts`, rentals and possessions by driver); the retirement's
"nothing open" (`renter-retirement.ts` via `app.is_renter_in_use`, and the
database functions); archive refused while a rental they drive is booked or
out (`rentals-under-way.ts`); a new rental names its driver
(`rental-records.ts`).

Stays the payer (`renter_id`): ledger, invoices and receipts
(`ledger-queries.ts`, `billing-documents.ts`), Owing and overdue
(`renter-money.ts`, `overdue-rentals.ts`, `attention-items.ts`), payments,
mandates and Stripe (`renter-payment-records.ts`, `renter-checkout.ts`,
`payments-links.ts`, `stripe-*`), bonds (`bonds-to-refund.ts`), the
contract, change of terms and their links (`signing-links.ts`,
`change-signing.ts`, `rental-changes.ts`, `contract-data.ts`,
`cancel-links.ts`, `renter-archived.ts`), document emails
(`document-emails.ts`), damage records' holder (`damage-records.ts`,
`recordDamageFromReturn`, `whoHadCar` from `possessions.renter_id`: the
business is charged; the driver shown on the damage page is slice 3), the
retirement's money and damage checks, and everything shown by Renter
(Renter page and list, rentals list, calendar, timeline, car pages, search,
export, everything we hold): the driver shown alongside comes with slices 2
and 3.

Later, each its own plan: ABN Lookup (decision 9); a business self-service
details link; a combined weekly debit and invoice (decisions 6 and 7); fines
(Phase 6).

### Test sheet rows (numbered when built, from the next free O- number, after O-488)

Slice 2: add a business Renter; ABN box (formats, checksum); business page
strip and each tab; Drivers tab add/remove; driver's Drives for; list
filters Businesses and Drivers; search by trading name and ABN; business Do
not rent; archive refused with drivers; export columns; everything we hold
(business, driver). Slice 3: driver picker and To be named; Name a driver
before handover; driver licence checks; authorised signing; business
contract template; payments link to contact; driver signs handover, return,
swap; document emails to driver and business. Slice 4: driver change.
Slice 5: business invoice layout; business statement; Money tab across
cars. Changed rows: Renters list (O-477 area), Renter page, new rental,
handover, invoices. No admin rows (admin can't see Renters).

### Rule wording (needs Abhi's approval, changed in slice 1)

- Rule 15: "Possession starts at the signed handover acceptance by the
  Renter or, for a business Renter, by its named driver … A car swap or a
  driver change closes one record and opens another."
- Terminology: "Driver: a person Renter named to drive a business Renter's
  car."
- docs/design/03, 04, 05, 06 and 07 updated to match.
- Note for later: docs/design/06 still says "Connect Express"; CLAUDE.md
  and phase-4 decision 1 say full dashboard. Flagged, not changed here.

### Out of scope

- Business logins or a business portal (Renters never log in).
- Shift-sharing records (decision 5); several drivers on one car at once.
- Combined debits, invoices or bonds across cars (later option).
- ABN Lookup (later slice); credit limits, director guarantees.
- Turning an existing person Renter into a business (kind is fixed).
- Fines handling itself (Phase 6), beyond keeping the data it needs.

### Self-review (senior engineer pass) and fixes made

- **Two meanings of `rentals.renter_id`**: found that licence checks,
  possession, damage and retention read it as "the driver". Fixed by
  `driver_id` on rentals and possessions, with each use sorted in slice 1.
- **Retention bug for drivers**: a driver with no own rentals would be
  retired 7 years after being added, mid-rental, and their scans dropped.
  Fixed by counting possessions, driver bookings and current links
  (Migration A step 8).
- **Shared PDFs**: a business rental's reports hold the driver's details;
  binning on the business's clock alone would destroy the driver's evidence
  (and the reverse). Fixed: binned only when every party is past 7 years.
- **Old deployed code during the deploy**: inserts rentals and possessions
  with no driver. Fixed by triggers that default the driver for person
  rentals and from the rental for possessions.
- **A driver who is also a Renter on their own**: one row (licence index);
  their own rentals' Owing is theirs only, business rentals stay on the
  business.
- **A driver moving between businesses**: link rows end and start; past
  rentals and possessions keep the old business; fines use the possession.
- **A business with no drivers yet**: can be added and booked ("to be
  named"); handover is blocked until a driver is named and passes checks.
- **Changing the driver mid-rental**: a possession change, done only with
  the new driver's signed acceptance (slice 4); never an edit of
  `rentals.driver_id` alone (the trigger refuses a driver change while a
  possession is open unless it is the driver-change transaction, which
  closes and opens possessions in the same step).
- **A business marked Do not rent**: blocks its new bookings and the
  contract link; current cars and drivers carry on (as for a person today);
  drivers are not marked automatically, since they may be blameless.
- **Archived drivers**: refused as new drivers; kept on old rentals and
  possessions; nominations still work (archived is not retired).
- **Fines for an old rental**: matched by car and time to the possession,
  which holds the driver and the business then, never the rental's current
  driver.
- **Tenancy**: every new link uses `(id, operator_id)` FKs; the new table
  has RLS enabled and forced; the driver trigger reads only the current
  Operator's rows; no session-less job is added.
- **Naming clash**: "business" already means the Operator in code; the code
  kind is `organisation`.

### Decisions after slice 1 (Abhi, 7 Nov 2026)

- A business with current drivers is kept even after seven years with no
  rentals: a current driver link means it is still a current customer.
- A business rental's damage records are blanked on the business's
  seven-year clock (the business is charged for damage); who had the car
  stays on the possession records, kept on each driver's own clock.

#### As built (slice 2, 8 Nov 2026)

Abhi's go: 8 Nov 2026. No migration: slice 1's tables, grants and triggers
were enough.

- **Add a Renter.** Person or Business first (new shared piece: choice
  cards, a Base UI radio group, in the component catalogue), Person ticked
  to start so the person form works as before; `?kind=business` opens the
  business form. The business form is its own Zod schema, the same in the
  browser and on save: legal name, ABN (grouped 2-3-3-3 as typed, the ATO
  checksum, kept as 11 digits; the one `requiredAbn` now shared with
  Settings), contact's name and email required; trading name, contact's
  phone, business address (address lookup) and postal address (ticked
  "same as the business address" by default, kept as none). A trading name
  the same as the legal name is kept as none. Names are free text (rule
  31). The person form refuses a business's id and the business form a
  person's, so neither writes over the other kind.
- **Renters list.** A grey outlined label (new badge tone `kind`, lighter
  than any status): Business, or Driver for <business>, one per business.
  A business is shown and sorted by its trading name, its legal name under
  it on a computer. Filters Businesses and Drivers (a person with a current
  link), with counts. Renting now and Booked count a driver with a
  business's car. A business with two or more cars out reads "3 cars out ·
  1 booked, starts …"; with one, as a person. A driver with nothing of
  their own to pay, in a business's car, reads "<business> pays". Search
  also finds a trading name, an ABN typed with or without spaces (each
  group is a word of the stored 11 digits) and a contact's name; the Rentals
  list and top bar search also find a trading name and a business rental's
  driver. The export adds Kind and Legal name columns, and Paid by (the
  business, for a driver whose business pays); its Owing column is always
  the amount, blank for such a driver (review fix, 8 Nov 2026).
- **A business's page.** Its own strip: trading name; legal name and ABN;
  "Contact Dana Wells" with Call, Text, Email; labels; Owing across cars (the
  same fact as a person's, from the ledger of all its rentals), Cars out
  (with the next booking), With you since (rentals and drivers). Tabs
  Overview, Drivers, Rentals, Money, Details, Notes, Log (no Licence; an old
  `?tab=licence` opens the Overview). Overview: still needed before renting
  (ABN, contact, email, business address), shared phone or email note, Money
  across cars (each car out or booked with its driver and its own balance),
  Cars out now, Latest note, Drivers (5, with standing), Contact. Money: car
  by car (charged, paid, owing per rental, from each rental's own lines by
  `ledgerTotals`; a reversal is always on its own rental, so the cars add up
  to the business: tested) above the whole ledger. Car by car loads only
  the rentals it shows (booked or out, or with money on them), those booked
  or out first, then the newest, up to 1,000; past that it says "Only the
  1,000 newest rentals are listed here", the totals still counting all. Details: its details, Do
  not rent ("stops new bookings; its cars out and its drivers carry on"),
  "A business has no details link", What we hold, Archive. Log: its record,
  notes and driver links; its added line reads "Business Renter added". A
  licence or a licence scan for a business is refused in app code ("A
  business has no licence of its own").
- **Drivers tab.** Current drivers as rows (cards on a phone): name (opens
  the driver), phone, the licence's kind, state and expiry (never its
  number), one standing label (Do not rent, To review, Licence not on file,
  expired, due, Current), the car out now, when added, and Remove (asks
  first) only with no car and no draft or booking naming them ("Has a car
  out", "On a booking" instead). Add a driver: choice cards "Someone already
  in your Renters" (a picker of current person Renters not marked Do not
  rent and not already its drivers) or "Someone new" (full name, and a phone
  or email, the person form's own rule). Someone new is added as a person
  Renter and linked in one transaction, then sent the details link when
  they have an email. Both get the privacy notice by email, now with the
  driver paragraph; when it can't be emailed (no email, or the send
  failed), the form shows the same "Give <name> the privacy notice" card as
  adding a person. Past drivers, latest first.
- **Locks.** Adding locks the business, then the person, then inserts the
  link (the trigger takes both shared). A business named as the driver is
  read without a lock and refused, so two crossed adds can't deadlock
  (tested). Removing locks the business, then
  the driver, then the link, checks no draft, booking or car out of the
  business names them, then ends it: the booking's order. A test runs a
  booking holding the business and driver, the removal waiting on it, and
  the booking then naming the driver (taking the link) without a deadlock;
  the removal is then refused (`business-renters.test.ts`).
- **Refusals in words.** Adding: a business ("can't drive for another
  business"), details removed, archived ("restore them first"), Do not rent,
  already a driver. Removing: named on a draft, booking or car out. Archive:
  a rental booked or out first, then "This business still has drivers" or
  "They still drive for a business". The app checks under the Renter's lock
  (a link insert locks both Renters shared, so the two run one after the
  other); the database's triggers remain the second layer.
- **A driver's page.** As a person's, plus Drives for (current and past,
  each opening the business) and Cars driven (from possessions, shown once
  they have driven a business's car); the strip has the Driver for label and
  "<business> pays" under Owing.
- **Everything we hold.** A business: Details (its own fields), Drivers (name,
  added, removed), all its rentals with a Driver column (names only), money,
  signing, damage, documents and the Log with its driver links; no Licence
  sheet or scans (none are sent even if one was stored against it). A person who drives or drove for a business: Drives for,
  Cars driven, Damage while driving (found at the returns of their
  possessions) and Reports signed driving (handover and return reports and
  swap forms of their possessions, with the PDFs); never the business's
  money. A person who never drove for a business gets the same download as
  before.
- **Not bookable yet.** A business Renter is left out of the New rental
  form's Renter picker, its strip has no New rental, and its Rentals tab no
  New rental link, until slice 3; a booking sent for one anyway is refused
  (no driver can be found for it yet). A business gets no details link: the
  server refuses one.
- **Demo data.** A "business" step after the Renters: Acme Rides (Acme
  Rideshare Pty Ltd, ABN 51 824 753 556, contact Dana Wells) with drivers
  Sam Taylor, Victor Lee and Hana Suzuki, and Wei Zhang as a past driver.
- **Deviations from the mockups.** Add a Renter stays a page, not a pop-up
  (as for a person today). The Log says "Driver added" and "Driver removed",
  not the driver's name (names are never written into the Log, rule 7).
  "Phone or email" for a new driver is two boxes, and the link goes only by
  email (SMS is not built: a driver with only a phone is told to add an
  email). The business strip's New rental, the Rentals tab's Driver column,
  Send a statement, How it pays, Bonds and Latest invoices on the Money tab
  come with slices 3 and 5. Owing on the list has no "across 3 cars" note.
  The Log's By filter is still drawn only.
- **Not built here (decision 8):** the optional ABN box on a person (a sole
  trader); it is printed on invoices, so it comes with slice 5.

- Decided 8 Nov 2026 (Abhi): a person already on file who is added as a
  business's driver is emailed the privacy notice every time, so they know
  what that business can now see about them.
- Decided 8 Nov 2026 (Abhi): until texting is built, a new driver with only
  a phone gets no details link and the app asks for an email (on the launch
  checklist).

#### As built (slice 3, 8 Nov 2026)

Abhi's go: 8 Nov 2026. Person Renters behave as before (their own tests
unchanged and passing).

- **Migration.** `0055_business_contract_template`: the
  `contract_template_kind` enum gains `business_contract` (the slice's
  "contract template kind"; decision 10). It reads and changes no rows; a
  test (`business-contract-template-update.test.ts`) runs it on a database
  filled at 0054 with a default rental contract, which stays as it was, and
  a business contract then becomes a default of its own kind beside it. No
  other schema change.
- **New rental.** The Renter picker offers businesses (by trading name,
  "Business · legal name · ABN" under it), never as someone's driver. With a
  business chosen: "The contract goes to <contact> to sign for <legal
  name>" and the driver picker (the shared choice cards, now with a stacked
  layout, a label, a warning and a not-choosable state, in the component
  catalogue): "Driver to be named" first and chosen, then each current
  driver with their licence's kind, state and expiry (never its number) and
  standing; a driver with another car out is warned ("Already has 1BRT482
  out. You can still pick Sam."), one whose details wait for review or who
  is Do not rent is shown but can't be picked; "+ Add a driver to <business>"
  opens its Drivers tab. Changing the Renter puts the driver back to "to be
  named". The picker loads only once a business is chosen, so the plain form
  keeps its JavaScript budget (510 KB); with a business chosen it is 542 KB
  measured, budget 595 KB (rule 33). The business strip has New rental, and its Rentals tab a Driver
  column; the Rentals list shows "driver Sam Lee" (or "driver to be named")
  under a business's name.
- **Booking checks.** New problems: `driver_not_named` (handover level),
  `business_details_missing` (handover level: ABN, contact's name and email,
  business address, from slice 2's rule) and `driver_has_other_car` (notice
  only). A named driver must be a person, not retired, not archived ("Restore
  them first") and a current driver of the business ("no longer drives for
  this business"), read after the business's lock; Do not rent on the
  driver or the business refuses the booking as before. On a business's
  rental the licence and age messages say "The driver's licence …".
- **Naming a driver later.** The rental page's Next step, while the driver is
  to be named: "No driver named yet", main button Name a driver (the same
  picker in a pop-up), no Start handover, and "The handover can't start
  until a driver is named and their licence passes the checks" (shown while
  no driver is named, whatever the main step). The Rental card has Name a
  driver too, Change driver once one is named (draft or booked only; once out
  it is slice 4). Saved with a warning (e.g. the business's address still
  missing), the pop-up stays open to be read. `nameRentalDriver` locks the rental, then the business, then the
  driver (the handover's order, see "Lock order" below), reads the rental
  under its lock (its Renter and status), runs the checks under the rental's own rules, and
  logs the driver's record id, never their name. Two-connection tests: a
  removal of the driver's link that started first makes the naming wait,
  which then finds them no longer a driver; a naming that started first
  makes the removal wait, which is then refused ("named on a rental").
- **The rental page.** The strip reads "1BRT482 · Acme Rides · driver Sam
  Lee" (each a link) or "· driver to be named"; the Rental card has Renter
  (trading name, then legal name · ABN) and Driver; the Next step ticks
  add "Driver named: Sam Lee" and the details tick is the driver's (or the
  business's own while they are missing); Check details opens whose they
  are. The signed contract is listed as "Business rental contract".
- **The business contract.** A business's rentals use the default "Business
  rental contract" template (Settings → Contracts → Kind). None yet: the
  rental's Contract card says so and sending is refused with "Set up a
  Business rental contract template first". The starter has the business's
  legal name, ABN, address, contact, phone and email (no date of birth or
  licence) and a note where the Operator writes who may drive and who names
  the driver on a fine. New merge fields (group "Business Renter (filled in
  only for a business)"): legal name, trading name, ABN, address, contact;
  each is empty for a person, so a person's contract that used one shows the
  gap before sending. The rent-terms warning covers both contracts.
- **Authorised signing.** The link goes to the contact (greeted by name).
  The signing page says "Check the details" and shows the business's
  details; section 4 asks for "Your full name" (filled with the contact's,
  changeable), "Your position" and the tick "I am authorised to sign for
  <legal name>.", each required and checked as typed with the server's Zod
  schema; a typed signature must match the name given there, never the
  business's. The evidence keeps the name, position and the exact ticked
  words; the PDF's signature line reads "Signed by Dana Wells, Director, for
  Acme Rideshare Pty Ltd" and the signing record has Signed for, Signed by,
  Position and Ticked rows. A change of terms for a business is signed the
  same way.
- **Payments link.** Already to the Renter's email, which for a business is
  its contact's; the email now greets the contact (Stripe's customer stays
  the business by its legal name).
- **Handover, return and swap.** The driver signs (rule 15): the typed name
  is checked against the driver's name (`signerNameOf`), never the
  business's; the pages say "For Acme Rides, driver Sam Lee", "The driver
  accepts the car", "The driver signs the swap"; the accepted words read "I,
  Sam Lee, received this car for Acme Rideshare Pty Ltd on …" (and
  "returned"), on the phone and in the report; the reports list "Renter
  (business)" and "Driver" and are "Accepted by Sam Lee for Acme Rideshare
  Pty Ltd"; a return with nobody there says "The driver was not present". A
  business's car never goes before a driver is named (`driver_not_named`
  blocks, as the database's rule does). Tests: the business's name is
  refused at the handover, swap and return; the driver's works; both
  possessions name the driver.
- **Emails.** The copies to the business's contact and the Operator name the
  driver and the business ("Sam Lee received 1BRT482 … for Acme Rideshare
  Pty Ltd"); the Operator's subject names the business. "Email again" says
  the same, the driver taken from the report's own possession.
- **Damage page.** Who had the car shows "Acme Rideshare Pty Ltd, driver
  Sam Lee" (the driver a link) from the possession of the return it was
  found at, or of the confirmed rental on the day; the suggestion from who
  had the car that day names the driver too.
- **Demo data.** The business step adds a starter "Demo business rental
  contract" (unless the Operator has one), so a booking for Acme Rides can be
  sent to sign straight away.
- **Not built here, and why.**
  - *Signer's name and position as merge fields* (plan, "Contract"): the
    text signed must be exactly the text shown (its fingerprint), and the
    signer is only known as they sign; so they are printed on the signature
    line and the signing record page instead.
  - *Change driver once the car is out* and *Who had the car* on the
    rental's page (mockup 6): slice 4.
  - Invoices still greet a business by its legal name; business money
    documents are slice 5.
- **Review fixes (slice 3 review).** The driver can't be named, changed or
  cleared while a handover checklist is under way ("Cancel the handover
  first"): `nameRentalDriver` checks under the rental's lock, which a
  handover's start also takes (two-connection test). The checklist's
  fingerprint now covers the driver's record and name, so a signature drawn
  for one driver (or a checklist saved offline and sent later) never hands
  the car to another: refused as changed, also under the rental's lock at
  completion. A handover can't start with no driver named, and Start
  handover is never offered beside the contract or bond while no driver is
  named. A driver whose details wait for review is refused on the server
  too, at booking and naming. The signer can't give the business's legal or
  trading name as their own. A business's signing page sends back a
  fingerprint of the text plus the authority's names and the detail rows
  shown, so a change between opening and signing is refused as changed.
  The Operator's copy of a signed business contract (and change of terms)
  names the business in its subject and who signed for it.
- **The driver's own copy (added 8 Nov 2026, Abhi's go).** Pulled forward
  from Migration B, nothing else of it: `0056_driver_document_copies` widens
  the `document_emails_recipient` check to allow `'driver'` (one statement;
  every existing row is `'renter'` or `'business'`, and the code deployed
  before it writes only those and reads each recipient by name, so it
  ignores a driver's row). A test (`driver-document-copies-update.test.ts`)
  runs it on a database filled at 0055 with copies already recorded: they
  stay as they were, the old code's two kinds still go in, a driver's copy
  now does, anything else is still refused. For a business's handover,
  return and swap, `emailDocumentCopies` sends a third copy to the driver
  who signed (the checklist's view the signature was checked against), to
  their email only, worded to them ("You received 1BRT482 … from <Operator>
  for Acme Rideshare Pty Ltd"; "You returned …"; "You swapped cars … for
  …: you now have …"), greeted by their name, from the Operator. Never for a
  person's own rental (they are the driver and already get theirs) or a
  contract. A driver with no email is recorded as no address ("Not emailed
  to the driver: no email on file", no Email again for it, as for the
  Renter); a failed send offers Email again, which sends only the copies
  that didn't go, the driver's among them, taking the driver from the
  paper's own possession (a swap form: the possession its swap's handover
  started), never the rental's driver now. The rental page reads "Emailed
  to the Renter, to the driver and to you". Tests: the driver's copy at the
  handover, the swap's three papers and the return; none for a person's
  rental; a driver with no email; Email again for a failed driver's copy;
  the driver's address in no other email.
- **Lock order (8 Nov 2026, from the slice 3 review).** Every change to a
  rental locks the rental first, then its checklist, then the car, then the
  Renter, then the driver, then the driver's link: booking a draft (rental,
  car, Renter, driver), starting a checklist (rental), cancelling (rental,
  then its holds and open checklists), the handover, return and swap
  (`recordIssuedDocument` locks the rental to number the report before
  anything else; then the checklist or swap, the car, and for a handover the
  Renter and driver), and the database's own driver rule (the rental row,
  then the driver and link shared). The review thought cancelling and a
  handover finishing could deadlock (cancel: rental then checklist; handover:
  checklist then rental); in fact the handover already holds the rental
  first, so one waits for the other: a two-connection test
  (`rental-lock-order.test.ts`) runs both orders: the handover that got the
  rental first finishes and the cancel is refused ("Only a draft or a
  booking can be cancelled."); the cancel that got it first cancels the
  checklist and the handover is refused as cancelled. Checking every caller
  found the real one: `nameRentalDriver` locked the business and driver
  before the rental, so naming a driver while the handover finished
  deadlocked (shown by a test before the fix). It now locks the rental
  first; two-connection tests in both orders: the handover first, naming is
  refused ("Only a business's draft or booking names its driver here."); the
  naming first, it is refused as a checklist is under way and the handover
  goes ahead. The earlier notes saying the handover locks "the Renter, the
  driver and then the rental" (slice 1 F5) describe the order among those
  two only: the rental was always locked before them. The one exception
  left is the retirement job (Renter, then their rentals), noted in slice 1.
  Swaps (second review, 8 Nov 2026): signing a swap locks the rental, then
  the swap, then the new car, then the old car's checklist and the new
  car's; cancelling one updated both checklists and then the swap without
  the rental, so the two could deadlock (each holding what the other
  needed). `cancelSwap` now locks the rental, then the swap, then the two
  checklists in signing's order, and reads the swap again under the lock:
  if it was finished or cancelled meanwhile it is refused in words ("This
  swap was already finished or cancelled, so nothing was changed."), shown
  beside Cancel swap. Two-connection tests (`swap-lock-order.test.ts`) in
  both orders: signing first, it finishes and the cancel is refused;
  cancelling first, it cancels and signing is refused as finished.
  Driver changes (slice 4 review, 9 Nov 2026): starting one locks the
  rental, then the car, the business and the new driver; finishing one
  locks the rental (to number the reports), the change, its two checklists,
  then the car, the business and the new driver. Before the fix both took
  the business and driver first and reached the car only through its
  checklists, possession and reading, while a booking of the same car (a
  new rental, or a draft being booked) takes the car and then the business:
  the two deadlocked (shown by tests before the fix). `lockDriverNamingParties`
  now locks the car first, so naming a driver on a draft or booking takes
  the car too. Two-connection tests in `driver-changes.test.ts`
  for starting and finishing, against a new rental and a draft being
  booked, in both orders: both go ahead. The slice 4 second review showed
  that "harmless" was not the whole story (a swap reached the old car after
  the business, and a checklist photo reached the car before its
  checklist): the sweep below replaces it.

  **The one order (second review of slice 4, 9 Nov 2026).** Every code
  path and database rule that locks these tables takes them in this order,
  skipping what it doesn't need. Which lock each takes is set out under
  "Lock modes" below: a row the app changes is locked for no key update; a
  row a new or changed row links to (a foreign key) is taken "key shared",
  which those locks leave free, so it no longer counts in the order; a row
  locked "shared" by a database rule or a photo does count, where it is
  taken:

  1. `rentals`: the rental being changed (an issued paper takes it first,
     to number the paper; the database's start rules for a swap or a
     driver change, and a new possession, take it again, already held).
  2. `car_swaps` / `rental_driver_changes`: the rental's swap or driver
     change.
  3. `inspections`: its checklists, a pair's return before its handover
     (an issued paper's link takes them shared first; a photo's start and
     its confirmation take them shared).
  4. `vehicles`: the car, or a swap's two cars in id order.
  5. `files`: a new photo, or one being confirmed (a paper's own file row,
     which nothing else touches, is updated with step 1).
  6. `renters`: the Renter or business, then its driver; a driver
     change's two drivers in id order.
  7. `organisation_drivers`: the driver's link (shared by the database's
     rules; locked to remove it).
  8. `car_holds` and `possessions`: written last, under the car's lock
     (the database's no-overlap rules make a clashing write wait for it).
     Releasing or moving the end of a rental's own hold (a cancel, a new
     end) is done under the rental's lock without the car's: such a write
     can make a booking of the car wait, but takes nothing afterwards that
     the booking holds. The one exception is the return (second review of
     slice 4, rule 8): it ends the possession and releases the rental's
     hold, and only then writes the car's status and reading, so it takes
     the car after its hold. A booking that holds the car never waits for
     that hold: its clash check reads the hold as saved, still covering the
     return's dates, and refuses the booking before it writes anything; only
     once the return is saved can a booking of those dates write its hold.
     A new possession of the car (a handover or a swap of another rental)
     is refused the same way while the possession is open as saved.

  | Path | Locks, in order |
  | --- | --- |
  | New rental (`createRental`) | car, Renter, driver, link (shared), hold |
  | Booking a draft (`bookRental`) | rental, car, Renter, driver, link (shared), hold |
  | Naming a driver (`nameRentalDriver`) | rental, car, business, driver, link (shared) |
  | Cancelling a booking | rental, its holds, its checklists, its links |
  | New end or ongoing (`changeRentalEnd`) | rental, its hold |
  | Starting a handover or return | rental, the new checklist (its car shared) |
  | Details, marks, cancelling one checklist | the checklist |
  | Starting a checklist photo (fixed) | checklist (shared), car, new file |
  | Confirming a photo | checklist (shared), the file, the photo it replaces |
  | Handover signing | rental, checklist, car, Renter, driver, hold, possession (rental and link shared), car's status |
  | Return signing | rental, checklist, possession, rental, hold, car's status, reading, damage (Renter shared) |
  | Starting a swap | rental, two checklists (both cars shared), the swap |
  | Swap signing (fixed) | rental, swap, old car's checklist, new car's checklist, both cars (id order), possession (Renter, driver and link shared), holds, cars' status, damage |
  | Cancelling a swap or driver change | rental, swap or change, return checklist, handover checklist |
  | Starting a driver change (fixed) | rental, car, business, both drivers (id order), two checklists, the change |
  | Driver change signing | rental, change, check-in, handover checklist, car, business, new driver, marks, possession, rental's driver (link shared), reading, damage |
  | Adding or removing a driver | business, person, link |
  | A Renter's details, status or archive | the Renter (then their links) |
  | A car's details, status, sale or papers | the car |
  | A photo of damage found later | car, new file |
  | A contract or change of terms signed by link | rental, link |
  | Bond by hand, or a correction of it | rental |
  | A new Stripe bond page kept (`startRenterCheckout`) | rental, the page |
  | Stripe's news of a bond, a direct debit or a debit (message, or the Renter back from Stripe's page) | rental, the page, the payment, direct debits, bond entry |
  | Reserving a debit (the nightly run, "Take it now") | rental, then writes the payment and its items (Renter, direct debit and charge lines key shared) |
  | Saving Stripe's answer, or the run's recovery of one | rental, the payment |
  | Stripe's news of a debit (cleared or failed) | rental, the payment, the ledger line and its link |
  | Stripe's news of a refund or dispute (bond or debit) | rental, the payment, then the bond entry or the ledger line and its link |
  | Pausing or resuming automatic debits | rental |
  | A one-off charge with how it is collected (charge form, damage) | rental, then writes the charge and its plan |
  | Changing how a one-off charge is collected | rental, the plan |
  | Sending a signing link | rental, change of terms, Renter, their links |
  | Sending a payments link (also after signing) | Renter, their links |
  | Sending a details link | Renter, their links |
  | A business's statement across its cars (slice 5) | the business (its statements take versions in turn) |
  | Retirement job | the Renter, then their rentals' records: the one exception, as nothing it reaches is in use |

  The database's rules: the driver change and swap start checks lock the
  rental (already held); the rental's driver rule takes the driver and
  link shared, after the business; a new possession takes the rental and
  link shared; a new driver link takes the business and person shared; the
  checklist, photo, mark and driver change guards only read.

  Fixed by the sweep, each with a two-connection test that showed the
  deadlock (40P01) before the fix: signing a swap against a booking of the
  old car, a draft being booked or a driver named on a later booking
  (`driver-changes.test.ts`, both orders: the swap now locks both cars
  after its checklists and before the possession); starting a checklist
  photo against signing a handover, return, swap or driver change
  (`checklist-photo-lock-order.test.ts`, `driver-changes.test.ts`: the
  upload now holds the checklist before the car, and a checklist finished
  meanwhile refuses the photo as not found); and two driver changes
  crossing the same two drivers of two businesses (the drivers now in id
  order).
  **Lock modes (third review of slice 4, 9 Nov 2026).** A reviewer showed
  four deadlocks (40P01) with the app's own code, none in the order above:
  each came from Postgres's foreign key checks. A new or changed row that
  links to another (a damage record to its car and rental, a ledger line to
  its rental and damage record, a submission to its Renter) takes the row it
  links to "key shared", one link at a time in the order the links were
  made; a row locked FOR UPDATE blocks that, so "add a row pointing at the
  car and the rental" took the car and then the rental, the reverse of the
  order. The cases: damage found later on a car while its handover was
  signed (the damage held the car shared and waited for the rental; the
  handover held the rental and waited for the car), and the same against a
  swap of that car or a driver change; confirming who had the car for
  damage while a charge for that damage was added to the rental (each held
  one and linked to the other); and a Renter's details sent through their
  link while the Operator archived them or changed their email (sending
  held the link and linked the submission to the Renter; the archive held
  the Renter and cancelled the link).

  The fix is the standard one: the app locks a row it changes FOR NO KEY
  UPDATE (`ROW_LOCK`, `@fleetapp/db/row-lock`; the linter refuses
  `.for("update")`). Two such locks on one row still wait for each other,
  as do a database rule's or a photo's "shared" lock, so every
  "one after the other" above holds as before (the two-connection tests
  for the rental, swaps, driver changes and checklist photos pass
  unchanged); a link's key share waits for neither. FOR UPDATE adds only
  the right to change a row's id or a column a link or unique key relies
  on, or to delete the row, and the app does none of those to a row it
  locks (such columns are ids, the Operator, a link's Renter and hash, a
  file's storage key, Stripe's ids and a few document ids; the one ever
  written on a locked row is kept below). The database's start rules for a swap and a driver change
  locked the rental again FOR UPDATE: already held, but the stronger lock
  waited for every link to the rental under way, so migration 0060 has
  them take the same lock (only the lock mode changes).

  Kept as FOR UPDATE, each for a reason: a change of terms
  (`lockChange`), as signing it writes its document id, a unique key, which
  takes that lock anyway (taken at the start, never raised halfway); a
  debit (`lockDebit`, weekly debits slice 5), as saving Stripe's
  PaymentIntent ID writes a column with a unique key, which takes it
  anyway: always under the rental's lock, and every write that links to a
  payment (its items, its ledger links, a bond entry, slice 6's retry) is
  under that lock too, so nothing waits on it there; the
  retention job's
  `lock_renter_for_retirement` (the Renter, then their rentals: the
  exception above, run only for Renters long out of use, and changed only
  through a new migration if it ever takes part in a deadlock); the AGS
  catalogue fix `correct_vehicle_make_model` (one car, then its own change:
  it waits for nothing while holding it); and the sign-in lockout's single
  statement on the login row (packages/auth, nothing else in its
  transaction).

  Nothing relied on FOR UPDATE making a link wait. Every check that a
  change makes of rows linking to it, under its lock, is matched by a lock
  the other side takes itself: an archive of a Renter or car against a
  booking (both lock the Renter and the car, review A8-1), a driver link
  (the business and person), a removal of a driver (the business, person
  and link), a checklist against its marks and photos (the checklist,
  shared for a photo), a submission against a link photo's confirmation
  (the link), and a ledger or bond line by hand (the rental).

  The one that did (fourth review of slice 4, 9 Nov 2026): Stripe's news
  about a bond (a bond paid on Stripe's page, a refund made in Stripe, a
  dispute) added its payment and bond entry without locking the rental, and
  had been kept apart from bond entered or corrected by hand only by the
  link's wait, and only partly. With that wait gone, cash recorded as
  Stripe's payment was being saved could hold the bond twice, and a
  correction could miss a refund. Now Stripe's side locks the rental first,
  before the page's row, the payment, a direct debit or the bond entry
  (`lockBondRental`, now `lockPaymentRental`, shared with the hand entries), whether it comes by
  Stripe's message or as the Renter comes back from Stripe's page; nothing
  in that transaction is locked before it but its own new record of the
  message. Whichever comes second sees what the first recorded: cash after
  Stripe's payment is refused as already held; a correction after a refund
  or dispute counts it; Stripe's news is always recorded, once per Stripe
  id (rule 20), since the money really moved. Cash recorded first, with
  the Renter paying Stripe's page in the same moment, is a real double
  payment: the hand entry keeps the page that was open under the rental's
  lock (`openBondPageId`) and asks Stripe about that page, so the Operator
  is told it was paid too ("held twice, refund one") even when Stripe's
  message was recorded first. That covers only a page already saved when
  the cash was: a page Stripe was still opening (the Renter pressed to pay
  as the cash went in) was saved afterwards, unseen by the hand entry,
  and handed out (review of the fourth review's fixes). So a new bond page
  is now kept only under the rental's lock too, after the bond still owing
  is worked out again: if the cash came first and nothing is owing, or
  less than the page is for, the page is expired at Stripe and not handed
  out (the Renter is told the bond was just received, or has changed).
  One or the other always sees the other: the page saved first is stopped
  by the cash entry; the cash saved first stops the page. Two-connection
  tests in both orders (`bond-lock-order.test.ts`): cash against a bond
  paid on Stripe's page, cash recorded while the page was opened (whole
  and part), and a correction of cash against a refund and against a
  dispute.

  Links sent to a Renter (fourth review of slice 4): sending a signing link
  or a payments link read the Renter unlocked, so one sent as the Operator
  archived the Renter or changed their email was missed by the change's
  cancelling of live links and stayed live (rule 26). Each now locks the
  Renter for no key update (`lockCurrentRenter`, as the details link
  already did) after the rental, and uses the email read under that lock;
  an archived Renter is refused with the usual words. The payments link the
  Renter goes on to after signing does the same, and goes ahead only while
  the signing link is not cancelled (signing itself marks it used) and was
  sent to the Renter's email as
  it now is (review of the fourth review's fixes): otherwise the phone that
  signed is not remembered and no link is made, and the Operator sends the
  payments link the usual way, which asks a new phone for a code. Two-connection tests
  (`renter-link-lock-order.test.ts`) in both orders against an archive and
  an email change: sent first, the change cancels it; changed first, the
  sending is refused or goes to the new email.

  Two-connection tests, each showing 40P01 before the fix and both going
  ahead after (`damage-lock-order.test.ts`: damage found while a handover
  or a swap of the car is signed, and who had the car confirmed while a
  charge for the damage is added; `driver-changes.test.ts`: damage found
  while a driver change is signed; `renter-link-lock-order.test.ts`: the
  details sent while the Renter is archived or their email changed, then
  the link cancelled). `driver-changes.test.ts` also shows a swap and a
  driver change starting while a link to the rental is being written
  ("waited" before 0060). And `checklist-photo-lock-order.test.ts` now has
  a test, in one set order, of a photo started while its checklist is
  signed: signing holds the checklist and waits for the car, the photo
  waits for the checklist, and is refused as finished once signing is done.
- **Second review fixes (8 Nov 2026).** Booking a draft refuses a driver
  whose details wait for review, as naming one and a new rental do (one
  `lockBookingParties` for both); naming again the driver the rental already
  names is "unchanged", even once their details wait. Start handover (and
  Start return) is the shared action button: refused, it says why beside
  it ("Name the driver first, then start the handover."). Email again on a
  business's contract or change of terms greets whoever signed for it (from
  the signing evidence) and names the business, through the same
  `businessSignerCopy` the first send uses. The checklist fingerprint takes
  a business's legal name, so a rename between the screen and the signature
  is refused as changed (a person's fingerprint is as it was). A handover
  reaching the lock with no driver named is refused as "No driver named
  yet", not as a Renter change. Each emailed copy's try is kept on its own,
  so one the database refuses never loses the others. The signer's name is
  refused as the business's with its company words written another way
  ("Pty Limited", "Proprietary Limited", "P/L", "Ltd"); a name with none is
  refused only when it is the same name (Dana Wells may sign for Dana Wells
  Pty Ltd). Cancelling a swap: see "Lock order".
- **For slice 4.** A driver change once the car is out must take the
  return's and swap's signer, and `movePossession`'s driver, from the open
  possession, read again under its lock, never from the rental's current
  driver: today `complete-swap.ts` (about line 396), `driverColumn` in
  `handover-queries.ts` (which also gives the driver's copy its address)
  read `rentals.driver_id`, which is only safe while the driver can't change
  with the car out. ("Email again" already takes the driver from the
  paper's possession.)
- **Deviations from the mockups.** The chosen Renter stays in the record
  picker (no separate "chosen" card with Change): the picker already shows
  it and lets it be changed. The driver choice cards keep the app's tick on
  the right rather than the mockup's radio dot on the left, as for Person or
  Business. On a phone the strip's "driver …" is in the title line rather
  than its own line.

#### As built (slice 4, 9 Nov 2026)

Abhi's go: 9 Nov 2026. Person Renters behave as before.

- **Migration C.** `0057_driver_changes`, a new file: the
  `rental_driver_changes` table as planned (from and to driver, reason,
  status, the check-in's return checklist and the new driver's handover
  checklist, `changed_at`, who started it, `cancelled_at`), with the
  protections of `car_swaps`: two-column links to the rental, both drivers
  and both checklists; one under way per rental; RLS enabled and forced;
  `SELECT, INSERT, UPDATE (status, changed_at, cancelled_at, updated_at)`
  for the web app, nothing for admin; a finished or cancelled change never
  changes again, and none is ever deleted. `inspections.is_for_driver_change`
  (default false) and `inspections_one_completed` widened to leave it out,
  with a check that a checklist is never both a swap's and a driver
  change's. Beyond the plan's list, each one the "same protections as
  `car_swaps`" asked for: a start check (the rental's car is out, its Renter
  a business, the change from the driver who has it, with its own two
  checklists under way, and no swap under way), the reverse on `car_swaps`
  (no swap starts while a driver change is under way), and
  `app.check_rental_driver` replaced so a car that is out changes driver
  only to the new driver of the change under way, from the one it started
  from: the database rule that the driver changes only through this flow.
  Tested on a database filled at 0056 (`driver-changes-update.test.ts`): a
  business's car out with its driver, a person's car out, a business's
  booking; the deployed code's checklists, swap and naming of a booking's
  driver still work; a car out refused a driver change with no change under
  way, or to another current driver than the one named; the possessions of
  a change meet at one instant and a "who had the car at T" lookup returns
  the old driver before it and the new one from it; another Operator sees
  nothing and the admin login can't read the table.
- **The flow (mockup 7), on the phone.** Change driver on the rental's strip
  and Rental card (a business's car that is out, no return or swap under
  way). Step 1, "Why and who": the business's other current drivers as the
  shared choice cards (licence, standing, cars out; one who can't be named
  is shown but can't be picked), "+ Add a driver", and why (required, kept
  with the change and printed on both reports, never in the Log). Step 2,
  "Check in from Sam": the return checklist beside the last handover, kept
  on the phone and queued for signal (rule 25: the page is cached by the
  checklists' service worker), then "Next: Mia signs". Step 3, "Mia signs":
  the car as Mia takes it (the check-in's readings, photo count and new
  damage), her checks, then Sam signs (or "Sam is here to sign" is unticked
  and the report says the driver was not present, as at a return; not
  offered when the rental's rules want a signature at a return) and Mia
  signs, each drawn or typed and checked against their own name, and Finish
  driver change. A navy strip in steps (a new `steps` option on the shared
  strip, in the component catalogue) heads each step. Cancel driver change
  on steps 2 and 3, and on the rental page while one is under way.
- **What finishing does**, in one transaction that issues both reports
  (rule 12): the rental, then the change, then both checklists (each
  re-read under its lock and compared with what the phone showed: the
  fingerprints cover the check-in, the new driver by id and name, the
  outgoing driver, and the business's legal name), then the business and
  the new driver (their link current, their checks run again: Do not rent,
  details, licence, age, provisional, archived, details waiting review),
  then the link (taken shared by the database). The check-in is completed
  with Sam's acceptance or "not present"; the new driver's checklist takes
  the check-in's readings and the damage already on the car (the last
  handover's marks and the check-in's new ones; photos stay stored once,
  with the check-in, rule 21) and Mia's acceptance; Sam's possession ends,
  the rental names Mia, Mia's possession starts at the same instant (rule
  15, `possessions_no_overlap` intact); the odometer is read; new damage
  found at the check-in is recorded against the business; the Log gets the
  change, the check-in and the rental's driver change by record ids only.
  Reports: the check-in's return report (Sam, beside the last handover) and
  Mia's handover report, each with a "Driver change: Sam Lee to Mia
  Thompson. Why: …" line. Emails: each report to the business's contact and
  the Operator, and to the driver who signed it (Sam gets the check-in, Mia
  the handover), to their own email (slice 3's driver copy).
- **For slice 4, done.** Who signs a checklist now comes from the car's
  possession records (`checklistDriverId` in `handover-queries.ts`): the
  driver whose possession it started or ended; for a driver change's
  handover under way, the new driver; for a return, a swap's pair or a
  driver change's check-in under way, the driver with the open possession;
  only a first handover reads the rental's driver. So the return's, swap's
  and the driver copy's driver and address follow the record.
  `endPossession` gives back the ended possession's driver, read under its
  lock, and the swap's `movePossession` starts the new car's possession with
  that driver (refused as changed if it isn't the one who signed). "Email
  again" already took the driver from the paper's own possession; tested
  for both reports of a change.
- **Kept apart.** One of a return, a swap and a driver change at a time:
  a return or swap won't start while a change is under way ("A driver
  change is under way. Finish or cancel it first."), a change won't start
  while either is. A change's checklists are cancelled only with it. A
  driver taking over a car can't be removed from the business meanwhile
  ("… or are taking a car over in a driver change"); archiving them is
  refused (they still drive for the business).
- **Who had the car**, on a business's rental page (mockup 6): each
  driver's time with the car from the possession records, newest first,
  the rego when the car changed, "Has it" on the current one. The rental's
  Overview lists each finished change (who to whom, why, when) with both
  reports and their emailed copies; the Papers tab names them "Driver
  change: check-in report" and "Driver change: handover report".
- **Tests.** `apps/web/test/driver-changes.test.ts`: starting (only a
  business's car out, another current driver, not Do not rent, not the same
  driver, not another Operator's person); signing (each in their own name,
  never the business's; possessions meet at one instant; a fine-style
  lookup; Sam not there; refused as changed when the new driver's name, the
  check-in or the business's legal name changes; a Do not rent since the
  start refused in words; the Log has no names or reason); after a change
  (the return and a swap signed by Mia, her possession moving with the car;
  Email again to the driver who signed each report); two-connection tests
  against cancelling (both orders), the new driver's removal (both orders),
  their archive, a swap starting and a return starting; tenancy (another
  Operator can't see, sign or cancel a change, or hand the car to their own
  person). Browser: `e2e/driver-change.e2e.ts` at phone width, keyboard
  choice of the driver, axe on each step and the rental page after, the
  pages' JavaScript under the checklist's 730 KB budget.
- **Review fixes (slice 4 review, 9 Nov 2026).** Two independent deep
  reviews; each fix has a test that failed before it.
  - *Deadlock with a booking of the same car*: see "Lock order".
  - *Damage photos after a change*: the new driver's checklist copies the
    marks already on the car, but a mark's photo is found by the mark it
    was taken for, so the next return or driver change showed that damage
    without its photo. Each copy now keeps the mark whose photo it shows in
    its existing key column (`client_key`, which a driver change's handover
    never otherwise uses), and a driver change's handover finds its marks'
    photos from those, still stored once (rule 21); no schema change.
    Changes finished before this fix (dev data only) still show those marks
    without photos. Tested through a return's comparison and a second
    driver change. (Replaced by a column of its own in 0059: see "Second
    review fixes".)
  - *Entries sent straight to the new driver's checklist*: saving details,
    adding or removing a mark and starting a photo on a driver change's
    handover are refused as not found (it is filled from the check-in as
    the new driver signs).
  - *Log*: each copied mark (its id, the checklist and the mark copied) and
    the new driver's checklist finishing are logged by ids only; the
    change's own entry also lists the warnings it went ahead with (codes
    only), as a booking's does.
  - *Retention*: `0058_driver_change_guards` (approved for this and the
    next item only) lets the retention job set a finished change's or
    swap's reason to "Removed" once every party to the rental is retired,
    as for the rental's other free text; nothing else on one ever changes.
  - *Database guard*: also in 0058, a change is completed only with both
    checklists finished, the old possession ended at its check-in and the
    new driver's started from its handover at that same moment, and the
    rental naming the new driver; a car that is out changes driver only
    with its change completed by the end of that transaction (a deferred
    check); and the car can't come back (the rental leaving "active") while
    a change is under way. Tested on a database filled at 0057
    (`driver-change-guards-update.test.ts`): the deployed code's own way of
    finishing still works.
  - *A change to another driver*: starting one while a change to someone
    else is under way is refused ("A driver change to another driver is
    already under way. Finish or cancel it first."); the same driver picks
    the change up as before.
  - *The rental's end*: the new driver's licence check at signing uses the
    rental re-read under its lock, not as first read.
  - *Zod at the signing actions*: the driver change's signing form (what
    it showed, the present tick, both signatures) and the swap's "what it
    showed" are parsed with Zod schemas (`signing-step-forms.ts`); every
    phone signature's boxes are checked with the same size limits, a
    signature too big to be one being refused as no signature.
- **Second review fixes (slice 4, 9 Nov 2026).** Each fix has a test that
  failed before it.
  - *Deadlocks*: a swap signed while the old car was booked, a draft of it
    booked or a driver named on its later booking; a checklist photo
    started while its checklist was signed (handover, return, swap or
    driver change); two driver changes crossing the same two drivers. See
    "Lock order" for the whole sweep and its table, which replaces the
    earlier "harmless" note.
  - *Damage numbering*: a driver change's copies of the damage on the car
    were made at one moment, so "Damage 1", "Damage 2" … could swap places.
    Each copy is now a millisecond after the last, in the car's order, and
    marks are listed by time then id everywhere they are numbered (the
    checklist screens, reports and the return's comparison all read one
    list).
  - *`0059_driver_change_records`* (Abhi's standing go for the obvious
    recommendation): `inspection_damage_marks.copied_from_mark_id`
    (nullable, linked to a mark of the same business) names the mark a
    copy shows, so its photo is found from that mark's; the phone's key
    (`client_key`) is the phone's again. The copies made so far are moved
    across where the key is the id of a mark of the same business. While
    the code deployed before 0059 still runs (minutes, during the deploy)
    it keeps copying into the key, so a database rule moves such a copy
    across as it is added, and points every copy at the first mark (that
    code would name a moved copy itself): chosen over a fallback in the
    lookup, which would have kept the key's double use in the code for
    good. The rule touches only a driver change's handover, which never
    takes a phone's mark. Also in 0059: a cancelled driver change's reason
    is cleared when the driver it would have handed the car to is retired,
    as well as with the rental's parties. That driver never had the car,
    so isn't one of the rental's parties; making them one would have kept
    every party's records on the rental until they were retired too, so
    the words that may name them go with them instead, and the rest of the
    rental stays as long as its parties' records do. And a driver change is
    completed only within ten minutes of the transaction's time, so a
    direct write can't backdate (or forward-date) the hand-over moment that
    fines are matched to: signing always uses the server's clock (never a
    time queued on a phone), and the margin covers making the two reports
    first. Tested on a database filled at 0058
    (`driver-change-records-update.test.ts`): the copies moved and the
    phone's keys kept; the deployed code's copies moved as they go in; a
    copy of another business's mark refused; a change finished an hour
    back or ahead refused; each cancelled reason cleared both ways.
  - *An oversized signature on a driver change* is taken as no signature
    and refused in the usual words, as at a swap, rather than failing the
    whole form.
  - *A photo started on a checklist finished meanwhile* is now refused as
    not found (before, it could be recorded against the finished checklist,
    though never confirmed onto it).

- **Departures from mockup 7, and why.** Sam signs on step 3, just above
  Mia, not at the end of step 2: both signatures are sent together, so a
  drawn signature is never kept on the phone between pages, and Sam reads
  the same summary Mia accepts. Two reports (the check-in's return report
  and Mia's handover report) rather than one "change report": each is a
  checklist's report as the possession records need, and a new document
  kind would be a schema change beyond Migration C. The emails are the
  ordinary return and handover report emails (each names the driver and
  the business), not a driver-change email of their own. The "Kept in the
  Log" line under Why the change reads "Not written into the Log" (rule 7).
  The step bars use the strip's pale teal for done steps. No "Driver
  change" in the demo data yet.

#### As built (slice 5, 9 Nov 2026)

Abhi's go: 9 Nov 2026. Person Renters' documents are as before (their own
tests unchanged and passing), but for a sole trader's ABN (decision 8).

- **Migration B.** `0061_renter_statements`, a new file:
  `issued_documents.renter_id` (two-column link to the Renter), `rental_id`
  made optional, `issued_documents_one_owner` (exactly one of the two) and
  `issued_documents_renter_statement` (only a statement is a Renter's), and
  `issued_documents_renter_version_unique (operator_id, renter_id, kind,
  version)`, whose index also serves listing a Renter's statements. The
  table's grants, forced row-level security and append-only rules cover the
  column as they are. Tested on a database filled at 0060
  (`renter-statements-update.test.ts`): the documents already issued stay
  as they were, the deployed code still issues a rental's documents, a
  Renter's statements are numbered 1, 2 … and a repeat is refused, both
  owners or neither and a Renter's contract are refused, another
  Operator's business can't be named and can't be seen, the admin login
  can't read the table, and nothing can be changed or removed. Every query
  joining `issued_documents` to `rentals` was checked: each reads a
  rental's own documents (by rental id, an inspection or a swap), so a
  Renter's statement is never among them; "Everything we hold" for a
  business now includes its statements ("All its cars" in the Rental
  column).
- **Invoices, receipts and credit notes to a business.** Addressed to its
  legal name, "Trading as" its trading name, its ABN, "Attention" its
  contact and its postal address (else its business address)
  (`billed-to.ts`); every line names its car and the driver who had it then
  ("Weekly rent: Rent, 2 to 9 Nov (1BRT482, driver Sam Lee)"), the driver
  found from the possession records by the same rule as the line's car
  (`LedgerLineView.driverId`), names only. A person's are as before; a
  sole trader's ABN is printed under their name. Emails go to the contact,
  "Hi Dana Wells", "The tax invoice from … to Acme Rideshare Pty Ltd for
  1BRT482 … is attached." A rental's own statement for a business is
  addressed the same way and names the car and driver on each line.
  Numbering, GST, idempotency and the ledger are untouched (no money
  calculation changed).
- **The statement across its cars (mockup 8).** `businessStatementFigures`
  in packages/core: each rental's own `statementFigures`, each line counted
  under Charged or Paid as `ledgerTotals` and the Money tab count it (one
  helper, `lineTotalsOf`): a charge is charged, a credit less charged, a
  payment paid, a refund less paid, a reversal under the total of what it
  undoes (review fix, 9 Nov 2026: a refund had been put under Charged and a
  credit under Paid). A car's brought-forward plus charged less paid is
  still its closing balance, and the business's totals are the sum of its
  cars'. The PDF: STATEMENT, the
  Operator's details, To (as an invoice), made, days, "AUD, GST included",
  "This is a statement, not a tax invoice.", the totals across all cars,
  then a table per car headed "1BRT482 · Toyota Camry · driver Sam Lee"
  (each driver in turn when it changed, "driver to be named" while none
  was), its lines with their invoice numbers, and its subtotals; How to
  pay; bonds held separately ("$1,000.00 held across 2 rentals"). Issued
  once (rule 12) as the business's own document, its version taken under
  the business's lock; emailed to the contact when ticked, every try kept
  in `document_emails`, the send logged by ids only.
- **Money tab across cars.** Two columns on a computer, one on a phone:
  Car by car and Charges and payments across cars (as in slice 2), beside
  Statement (From and To, "Email it to Dana Wells" ticked when there is an
  email, Make statement; each statement made, how it was last emailed,
  Open and Email again), How Acme Rides pays (its one direct debit's state;
  "One setup covers all its cars; each car is debited on its own"), Bonds
  (held, car by car, from each rental's bond account) and Latest invoices
  (the five newest invoices and credit notes across cars, each with its
  car, opening the PDF from its rental). The Overview's Money across cars
  card has Send a statement, opening the Money tab at the statement.
- **Owing.** The strip's Owing across cars names the late car: "5 days
  late · 1BRT482" (the longest-late rental, each worked out from its own
  lines). The Renters list's Owing for a business reads "across 3 cars"
  (or "1 car") under the amount: its rentals with money on them.
- **A sole trader's ABN (decision 8).** An ABN box under "Sole trader" on
  the Operator's person form (grouped as typed, the ATO checksum, the same
  Zod rule in the browser and on save), on the Details tab and in
  Everything we hold. Not on the Renter's own details link, and approving
  what a Renter sends never touches it.
- **Tests.** `business-statement.test.ts` (core): the statement adds up to
  the whole ledger and to each rental's own, credit on one car never hides
  another's arrears, brought forward into a later range.
  `business-money-documents.test.ts`: a business's invoices addressed and
  emailed to it, each line's driver from the possessions, GST on its
  invoices equal to the ledger lines', invoice numbers gapless when two
  cars' invoices are issued at once on two connections (both waiting on
  the numbering held by a third), the statement equal to the sum of its
  rentals to the cent car by car, issued, emailed, listed, emailed again,
  two at once taking versions in turn, logged without names, none for a
  person, and tenancy (another Operator can't prepare, issue, list, open
  or email one, reads no cards, and its own business's statement holds
  only its lines). `billing-pdf.test.ts`: the To lines, a business's and a
  person's invoice lines, the statement's totals, car headings and
  subtotals. Browser: `business-rentals.e2e.ts` (the invoice emailed to the
  contact, Send a statement, the Money tab's cards, a statement made by
  keyboard and emailed, its PDF, "1 car" on the list; phone width, axe,
  the tab's JavaScript budget) and `renters.e2e.ts` (the ABN box).
- **Departures from mockup 8 and the slice 2 drawings, and why.**
  - The statement form has one button, Make statement, with "Email it to
    Dana Wells" ticked, not "Email to Dana Wells" and "Download PDF": the
    shared change form sends one way; every statement made is listed with
    Open (the PDF) and Email again.
  - A statement is listed as "Statement 1, made Sun 1 Nov", not "Statement,
    12 to 31 Oct": the days are printed on the PDF but not stored beside it
    (that would be a column beyond Migration B).
  - The PDF has no coloured Charged/Paid/Owing boxes and reads "Balance:
    Owing $380.00": the shared PDF layout prints label and value lines;
    "Balance" because the value already says owing or in credit.
  - How it pays shows the direct debit's state, not "Set up by Dana Wells
    Tue 6 Oct": who set it up and when are not recorded on it.
  - Bonds lists the bond held on each car, not the bond refunded on a
    finished one; each car's own rental page has its bond's full account.
  - The Log doesn't list statements (a rental's Log doesn't list its papers
    either); the send is in the activity log, by ids.
- **Review fixes (9 Nov 2026, two independent reviews).** Each has a test
  that failed before it.
  - *Charged and Paid* count each line as the ledger does (above).
  - *Car headings* name only the cars and drivers of the lines in the days
    asked (a swap or driver change before them no longer shows the old car
    or driver); with only a balance brought forward, the car and driver now.
  - *Retention*: `0062_business_statement_retention` replaces
    `app.is_retired_renter_file` and `app.retire_renter` (from 0047 and 0059,
    one line added to each) so retiring a business bins its own statements'
    PDFs, as a rental's papers are binned; the rows stay. Tested on a
    database filled at 0061 (`business-statement-retention-update.test.ts`):
    before it the PDF stayed; after it a retired business's goes, another
    Operator's stays until its own retirement, a person's rental papers go
    as before, and the app still can't bin a current business's.
  - *Emailing as it is made*: once the statement is issued, an error
    emailing it or recording the send is logged by ids only and the answer
    says it wasn't emailed (use Email again), so trying again never issues a
    second version.
  - *Archived or retired business*: refused a new statement, read under the
    lock that numbers it (two-connection test: an archive while the
    statement waits is seen); the Money tab says to restore it first.
