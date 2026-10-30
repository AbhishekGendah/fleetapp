# Phase 2 step 3 plan — Renters

Status: approved (30 Oct 2026). Part 3a built. Detail for slice 3 of
docs/plans/phase-2.md (already approved in outline). Slice 4 (the link a
Renter fills in on their phone) and slice 5 (deleting old licence scans)
come after, each with its own plan.

Built and deployed in three parts, each tested on the dev site first.

## 3a — Renter record, list and page

**Renters in the menu:** a new "Renters" section between Cars and
Settings, in the phone's bottom bar and the computer's sidebar.

**Renters list** (the shared list, cards on a phone, whole card tappable):
- Name (preferred name in brackets if given), phone, licence expiry with
  the Due soon / Expired badge, and status (Active, Do not rent in red,
  Archived).
- Search by name, phone, email or licence number. Filter: Active, Do not
  rent, Archived. Sort by name or licence expiry.
- Export (CSV/Excel) holds name, phone, email, licence expiry and status
  only, never date of birth, address or licence number. Every export is
  written to the Operator's activity log (who and when).

**Add a Renter** (its own page, with the back arrow, like Add a car):

| Field | Required | Format (rule 31) |
| --- | --- | --- |
| Full name | yes | as typed, extra spaces removed |
| Preferred name | | as typed |
| Phone | phone or email | Australian phone formatter |
| Email | phone or email | lower case, checked as an email |
| Date of birth | | date; must be in the past and at least 16 years ago |
| Home address | | Google address search (as for car sellers) |
| Postal address | | "Same as home" ticked to start with |
| Emergency contact: name, phone, relationship | | phone formatter |

Only the name and a way to contact them are needed to save. That way an
Operator can start a Renter from a phone call, and slice 4's link fills
in the rest. The page then shows **"Still needed before renting"**:
date of birth, home address, licence details, licence front and back.
Rentals (Phase 3) will refuse a Renter until that list is empty.

**Renter page** (back arrow to Renters, the name and status badge at the
top, icon tabs like the car page): **Details**, **Licence**, **Notes**,
**Log**. Later phases add Rentals, Payments and Fines tabs.

- **Details tab:** everything above with Edit; age shown next to the date
  of birth.
- **Status:** Active or **Do not rent** (a reason is required, private to
  the Operator, never shown to the Renter's link or to other Operators).
- **Archive / Restore:** hides the Renter from the list; nothing is
  deleted (rule 13).

**Duplicates:**
- **Same licence** (same number from the same state or country) is
  refused, including archived Renters, with "This Renter is already on
  file: Open" (and Restore if archived). The database enforces it too.
- **Same email or phone** as another Renter saves, with an amber note
  naming them and an Open link. Family members often share an email or a
  phone, so this one is a warning, not a refusal.

**Log tab:** who did what and when. Personal details are never written
into the log, only which one changed ("Phone changed"), the same as the
car buyer's and seller's details.

## 3b — Licence

On the Licence tab, with Edit in a pop-up:

| Field | Required to save the licence | Format |
| --- | --- | --- |
| Issued in | yes | WA, NSW, VIC, QLD, SA, TAS, ACT, NT or Overseas |
| Country | if Overseas | list of countries |
| Licence number | yes | capitals and digits only; 10 at most (Australia), 20 (overseas) |
| Class | yes | C (car) to start with; LR, MR, HR, HC, MC |
| Type | yes | Full or Provisional (P plates) |
| Expires | yes | date |

- **Expiry badge** (Due soon / Expired) on the tab, the page header and the
  list. New setting under Settings → Renters: "Show Due soon this many
  days before a licence expires", 30 to start with (1 to 90).
- **Front and back scans:** two slots, each with "Take photo" (the in-app
  camera) and "Choose file" (image or PDF). Images are shrunk on the
  phone. Replacing a scan sends the old one to the 30-day bin.
- **Scans are never shown as thumbnails.** A slot says "Front: added
  30 Oct 2026" and has a **View** button. Every View is written to the
  Renter's Log with who looked (rule 8), so loading the page must not
  count as looking. Views open in the in-app viewer.
- Scans live in the separate identity storage, like sale papers, and
  only open through 5-minute links.

## 3c — Notes and "everything we hold"

- **Notes tab:** add a dated note ("Write facts only: the Renter can ask
  to see this"). Newest first, with who wrote it and when. Notes are not
  edited; one written by mistake can be removed and stays in the Log.
- **Download everything we hold** (Details tab): one Excel file with a
  sheet each for details, licence (the number included), status and
  reason, notes, a list of scans and when each was viewed, and the Log.
  For a Renter who asks what is held about them (privacy law, APP 12).
  The download is logged. Scans themselves are opened from the page.

## Database (one migration per part)

- **3a:** `renters` (operator_id required, forced row-level security, the
  Operator-only policy, no deletes, a two-column key for links). Full name,
  preferred name, date of birth (a date, never a time), phone, email,
  home and postal address, emergency contact, status, do-not-rent reason,
  archived_at. Activity log type "renter".
- **3b:** licence columns on `renters` (issued in, country, number, class,
  type, expiry), with a unique rule on Operator + issued in + country +
  number that includes archived Renters. Files get a new kind
  ("licence scan", identity storage), a two-column link to the Renter and
  which side (front or back), with database checks; at most one current
  scan per side.
- **3c:** `renter_notes` (append-only apart from being removed, same
  protections). Activity log type "renter note" and the "exported" action.
- **The admin login gets nothing** on any Renter table or the new file
  columns (rule 5). A test proves the admin role is refused, alongside
  "Operator A cannot read Operator B's Renters, licences, scans or notes".

## Legal side (into docs/legal-notes.md as each part is built)

- Renters' personal information starts being collected here. Before the
  first real Operator: the privacy policy, the Renter privacy notice and
  the Operator terms (who is responsible for what) need the lawyer.
- **Do not rent reasons and notes** can be asked for by the Renter (APP
  12), and a reason about a crime or health would be "sensitive
  information" under the Privacy Act. The screens say: facts only.
- **Overseas licences:** each state limits how long a visitor can drive on
  one, and needs it in English or with an International Driving Permit.
  The form hints at it; check each state's rule before go-live.
- **Date of birth, licence number and scans** are the high-risk items:
  never in the log or exports of lists, scans in identity storage with
  every view logged, deleted on a timer in slice 5.
- No shared "do not rent" list between Operators.

## Test checklist

Each part adds its rows to the test checklist as it is built.

## Decisions in this plan (pushed back on easily)

1. **Only a name and a phone or email are needed to start a Renter**; the
   rest shows as "Still needed before renting". Tradeoff: incomplete
   records exist for a while, in return for starting from a phone call
   and fitting the self-onboarding link.
2. **Same email or phone is a warning, same licence is a refusal.**
   Tradeoff: two Renters can share a contact, which families do.
3. **"Overseas" is chosen where it was issued, not as a licence type**, so
   a licence cannot be both "WA" and "overseas". Type is Full or
   Provisional only.
4. **Scans are never shown as thumbnails**, only behind View, so every
   look is a deliberate, logged view. Tradeoff: one more tap to see a
   licence.
5. **One current licence per Renter.** A renewed licence is an edit (the
   old details stay in the Log, the old scans go to the bin). Tradeoff:
   no list of past licences, which nothing needs yet.
6. **Minimum age and provisional-licence settings come with rentals**
   (Phase 3), where they are checked. This step only shows the age.
