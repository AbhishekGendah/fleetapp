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
- `document_emails.recipient` gains `'driver'` (check widened).

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
