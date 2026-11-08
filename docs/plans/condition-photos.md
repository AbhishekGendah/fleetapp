# Condition photos: a free gallery and albums

Status: **draft for Abhi's approval (8 Nov 2026).** Nothing is built until he
says go, slice by slice. It touches schema, settings snapshotted on rentals
(rule 14), signed reports (rule 12) and the offline checklist (rule 25), so
CLAUDE.md asks for a plan first. Source: Abhi's decisions of 8 Nov 2026 (2)
and (3). Mockups are being drawn on the design canvas ("mockups (8 Nov)");
every changed screen waits for them (rule 34). Design docs read: 02
(Vehicles), 04 (Rentals), 05 (Contracts, signing and handover), 08 (Shared
services). Rules 8, 11 to 15, 19, 21 to 25 and 33 apply throughout. The sister
plan docs/plans/find-a-car.md adds the Showroom photos.

---

## What this means for you

- **No more named photo list.** Today Settings has a list of 8 photos
  (Front, Rear, Left side …) and the checklist won't let the Renter sign until
  every one is taken. Instead, each pickup, return and swap gets **one free
  gallery**: take as many photos as you like (none up to 30), in any order,
  and add a short note to any photo ("scratch by the fuel cap").
- **Settings becomes one choice**: photos at pickup, return and swap are
  **Optional** (the default for new businesses) or **Required** (at least one
  photo before the Renter can sign).
- **Damage stays as it is**: marking damage on the car outline, with a photo
  of each mark, and damage records.
- **Photos are kept in albums.** Every pickup, return and swap is an album
  ("Pickup · Tue 3 Nov · Jamie Park · 12 photos"). A car's Photos tab is
  renamed **Condition photos** and shows its albums, newest first. A rental's
  page gets a **Photos** tab with that rental's albums.
- **At the return**, the pickup album of the same rental opens beside the
  return's gallery, so you can compare.
- **Everything already signed stays exactly as it is**: old checklists, old
  reports and their photos never change (rule 12). Old photos show in the
  albums with their old names ("Front").
- **Poor signal still works**: photos wait on the phone and send when there's
  signal, as today. New: the Renter can't sign while photos are still waiting
  on the phone, so none can be left out of the report by accident.
- **What the Renter signs is still exactly what the report shows**: every
  photo in the gallery when they sign is in the PDF, in order, with its note.
  If a photo can't be put in the report, nothing is signed (as today).

### Decisions you need to make

Each has my recommendation and the main tradeoff. Say yes, or push back.

1. **Rentals booked before the change** move to the free gallery with
   "Required: at least one photo" (not their old list of 8), and each such
   rental's Log says so. Recommend: yes. Tradeoff: an old booking's next
   checklist no longer insists on all eight shots; in return the app keeps
   one way of taking photos. The alternative (old rentals keep the named list
   until they end) means keeping the old checklist in the app for as long as
   any ongoing rental made before today runs, possibly years.
2. **Businesses already using the app start on Required**; new businesses
   start on Optional. Recommend: yes. Tradeoff: an existing business that
   wants Optional changes it in Settings; in return nobody's checklist gets
   less strict without them choosing it. (On the dev site these are test
   businesses only.)
3. **Up to 30 photos per checklist.** Recommend: yes. Tradeoff: a very
   thorough pickup is capped; in return the report stays a sensible size (a
   return report holds the pickup and return photos, about 2.5 MB at most)
   and quick to make on the spot.
4. **A photo's note is printed under it in the report**, up to 200
   characters. Recommend: yes. Tradeoff: notes become part of the signed
   record, so they can't be changed after signing; in return the Renter signs
   to the note as well as the photo.
5. **The return report shows the pickup photos, then the return photos**
   (one after the other, no longer in matching pairs). Recommend: yes, as
   today the report shows both. Tradeoff: a longer PDF; in return one
   document shows the car at both ends.
6. **"Required" means at least one photo in the gallery**; photos of damage
   marks don't count towards it. Recommend: yes. Tradeoff: a car with only a
   damage photo still needs one general photo; in return "Required" always
   means the car's overall condition was recorded.
7. **With Optional and no photos taken**, the checklist warns once ("No
   photos taken. Photos are your proof of the car's condition.") and the
   report says "No photos were taken." Recommend: yes. Tradeoff: one extra
   tap; in return an empty album is a recorded fact, not a gap.
8. **No loose uploads on the Condition photos tab.** Every condition photo
   belongs to a pickup, return, swap or damage record; a dent spotted in the
   yard goes in through Record damage. Photos already added on a car's Photos
   tab stay, in an album called "Other photos". Recommend: yes. Tradeoff: no
   quick "add a photo" on the car; in return every condition photo has a
   date, a rental or a damage record behind it.
9. **Fingerprint each photo** (a SHA-256 code of the full-size photo, kept
   with it and listed on the report's last page). Recommend: yes. Tradeoff: a
   little more work for the server at each upload; in return, if a Renter
   disputes damage, you can show the full-size photo is exactly the one in
   the signed report, not just the small copy printed in it.
10. **Photos taken on one phone after the checklist was signed on another**
    are kept, in "Other photos", labelled "taken during the pickup on Tue 3
    Nov, after it was signed", and the phone says so. Recommend: yes.
    Tradeoff: they're not in the signed report (they can't be: the Renter
    never saw them); in return they're not thrown away.

---

## Technical detail (for the builder)

### What the code does today (findings)

- **Settings**: `handoverPhotos` in `operatorSettingsSchema`
  (`packages/core/src/settings.ts`), `handoverPhotoListSchema` (1 to 20
  unique names, each up to 60 characters), default `DEFAULT_HANDOVER_PHOTOS`
  (8 names), edited on Settings (`PhotoListForm`, `photo-list-actions.ts`).
  A stored settings document holds only what the Operator changed; missing
  keys read as their default. Each rental keeps a **full, frozen copy**
  (`snapshotSettings`), so every rental's `settings_snapshot` contains
  `handoverPhotos`. Snapshots are read with today's schema
  (`readSettings(operatorSettingsSchema, rental.settingsSnapshot)`); unknown
  keys are dropped by Zod, missing keys take today's default.
- **Checklists** (`inspections`, kinds `handover | return`; a swap is a pair
  with `is_for_swap`): `photo_names text[] NOT NULL`, copied at the start
  from the snapshot (handover, swap handover) or from the latest finished
  handover of that car (return, swap return: `handoverPhotoNames`). A
  finished or cancelled checklist can't change (trigger
  `keep_finished_inspection`, 0033).
- **Checklist photos** are `files` rows: `purpose = vehicle_photo`,
  `inspection_id`, `inspection_photo_name` (one in use per name: unique index
  `files_one_inspection_photo`; a retake replaces it,
  `markRetakenPhotosDeleted`) or `damage_mark_id`. Small copies
  (`vehicle_photo_thumbnail`, 400 px) point at the photo and carry no
  `inspection_id` (check `files_inspection_photos`). A photo can only join a
  checklist in progress, and a finished one's photos can't be removed,
  purged or moved (`keep_finished_inspection_photos`, 0045). The confirm takes
  the checklist row `FOR SHARE`, so signing and a photo arriving never cross.
- **"Missing photo stops report" is two rules**:
  1. `handoverGaps`: every name on the list must have a photo (and each
     damage mark its photo) before the Renter can sign.
  2. `ReportPhotoMissingError`: a photo that was taken but can't be loaded
     into the PDF (after one retry) stops the signing (review G9-7); old WebP
     photos print as a note.
  Plus **"shown equals signed"**: `checklistFingerprint` (details, photos by
  name, damage marks) is sent with the signature and checked again under the
  lock that issues the report (`assertChecklistUnchanged`, review A6-10).
- **Reports**: `handover-report.ts` prints the list's photos in list order
  then damage photos (small copies, rule 21); `return-report.ts` pairs each
  name's handover and return photo. Issued as `issued_documents` with a
  SHA-256 (rule 12).
- **Offline** (`lib/handover/offline`): Dexie database on the phone, a queue
  of marks and photos (`QueuedPhotoTarget = {photoName} | {damageMarkId} |
  {markKey}`), sent oldest first, each removed only once the server has it;
  a gone target is dropped; wiped once finished or after 7 days. Damage marks
  have a phone key (`client_key`) so a resend never makes a second mark;
  **photos have none**: today a resent named photo just replaces itself,
  but a resent gallery photo would be a duplicate.
- **Car Photos tab** (`photos-tab.tsx`, `listCarPhotos`): every
  `vehicle_photo` of the car in one grid, newest first: ones uploaded on the
  tab, checklist photos and damage photos alike.
- **Long-term storage** (`long-term-storage.ts`, 0050): photos of rentals
  returned over a year ago move to S3 Glacier Instant Retrieval (rule 23).
  **Bug found (to confirm with a test first)**: it finds files by joining
  `files.inspection_id`, which small copies never have, so small copies are
  never moved.
- **Retirement** (0053 `retire_renter`): bins every file with an
  `inspection_id` of the cleared rentals and blanks checklist free text
  (typed name, notes, accessories, reasons, damage mark descriptions).

### The new model

- A **gallery photo** is a `files` row with `purpose = vehicle_photo`,
  `inspection_id` set, and neither `inspection_photo_name` nor
  `damage_mark_id`. The existing checks already allow this shape; nothing
  makes one today.
- A checklist's **photo rule** is stored on the checklist when it starts
  (like `photo_names` was): `optional` or `required`, from the rental's
  snapshot. Old finished checklists keep `photo_names` and have no rule.
- **Albums** are not a table: an album is a checklist (or a damage record, or
  the car's "Other photos") and its photos. Nothing new to keep in step.

### Migration A (slice 1), on a filled database, backwards compatible

Every step works with the code already deployed (migrations run before the
new code goes live; progress.md "Open items").

1. `inspections.photo_rule text`, added **nullable with no default** (so
   every existing row stays null, meaning "made with a named list"; adding a
   column fires no row trigger, so finished checklists are untouched), then
   `ALTER COLUMN photo_rule SET DEFAULT 'required'` (only future inserts: the
   old code, still running for a few minutes, inserts checklists without it
   and gets `required`, which the new code reads correctly). Then
   `UPDATE inspections SET photo_rule = 'required' WHERE status =
   'in_progress'` (allowed: in progress is editable). Checks:
   `photo_rule is null or photo_rule in ('optional', 'required')`;
   `status <> 'in_progress' or photo_rule is not null`. `photo_names` stays
   NOT NULL; new checklists store `'{}'`.
2. `files.photo_note text`, nullable. Check `files_photo_note`: `photo_note
   is null or (inspection_id is not null and damage_mark_id is null and
   inspection_photo_name is null and char_length(photo_note) between 1 and
   200)` (`MAXIMUM_PHOTO_NOTE_LENGTH`, decision 4).
3. `files.client_key uuid`, nullable, set at insert only: the phone's own key
   for a gallery photo. Partial unique index `files_one_gallery_photo_per_key
   (operator_id, inspection_id, client_key) WHERE client_key IS NOT NULL AND
   refused_at IS NULL AND deleted_at IS NULL`. Check: `client_key is null or
   (inspection_id is not null and damage_mark_id is null and
   inspection_photo_name is null)`.
4. `files.sha256 text` (decision 9), nullable (old photos have none). Check
   `sha256 is null or sha256 ~ '^[0-9a-f]{64}$'`; set once at confirm.
4b. `files.late_for_inspection_id uuid`, nullable, two-column link to
   `inspections` (decision 10): a photo that reached a checklist after it was
   signed. Check: set only on a `vehicle_photo` with no `inspection_id`,
   `damage_mark_id` or `damage_record_id`. It keeps the usual photo name as
   its label ("1ABC234 2026-11-03 014", so `files_one_photo_name_per_car`
   still holds); the album shows "taken during the pickup on Tue 3 Nov, after
   it was signed" from the link. It is not `inspection_id`, so the finished
   checklist, its fingerprint and its report are untouched.
5. Grants: `UPDATE (photo_note, sha256)` on `files` to `web_app_role`.
   Nothing for the admin roles (notes may name people; rule 5).
6. Trigger `keep_finished_inspection_photos` replaced (`CREATE OR REPLACE`,
   starting from 0045's body): also refuses a change to `photo_note` or
   `sha256` once the checklist is not in progress (completed **or**
   cancelled), and `sha256` once set.
7. Trigger on confirm (`BEFORE UPDATE OF confirmed_at` on `files`): a gallery
   photo may not be confirmed when its checklist already has 30 confirmed
   gallery photos in use (`MAXIMUM_CONDITION_PHOTOS`, decision 3). The app
   confirm takes the checklist row `FOR UPDATE` (not `FOR SHARE`) for a
   gallery photo, so two confirms of the 30th and 31st queue, and the count
   is right.
8. Trigger on finishing (`BEFORE UPDATE OF status` on `inspections`, when the
   new status is `completed` and `photo_rule = 'required'`): at least one
   confirmed gallery photo, or named photo, in use (decision 6). The app
   checks first with a message; this is the second layer (as rule 2 is for
   tenancy).
9. Indexes: `files_inspection_idx (operator_id, inspection_id, created_at)
   WHERE inspection_id IS NOT NULL` (albums and the checklist read photos by
   checklist; today only a partial unique index on named photos exists) and
   `files_thumbnail_of_idx (operator_id, thumbnail_of_file_id) WHERE
   thumbnail_of_file_id IS NOT NULL` (every photo list joins its small copy).
   Built in the migration's transaction (not concurrently): fine at today's
   size (dev only, production empty); a note goes in the migration.
10. **Retirement** (new function body via `CREATE OR REPLACE`, starting from
    0053's exactly, never editing 0053): also `photo_note = NULL` on the
    cleared rentals' checklist photos (they are binned as before; the note is
    free text that may name the Renter).
11. **Existing businesses' settings** (decision 2): for every Operator, insert
    the settings row if missing (version 0, as the app's first save does),
    then `settings = settings || '{"conditionPhotoRule": "required"}'` and
    `version = version + 1`, and an activity row (actor `system`, entity
    operator settings) "Condition photos: Required (was a list of N photos)".
    The old `handoverPhotos` key is left in the document (harmless: the new
    schema ignores it, and leaving it lets a rollback read it).
12. **Rentals made before** (decision 1): for every draft, booked or active
    rental (their snapshots have `handoverPhotos` and no
    `conditionPhotoRule`), one activity row (actor `system`, entity rental):
    "Checklist photos for this rental: at least one photo; the list of N named
    photos is no longer used." The snapshot itself is never rewritten.

Why this is safe while the old code is still live for a few minutes: the old
code reads settings with its own schema (the new key is dropped on read, but a
save keeps it, as `applySettingsChanges` stores the merged raw document); its
checklists get `photo_rule = required` by default and are stricter than needed
(all names); its named photos keep working (the named-photo index and checks
are unchanged). A test runs Migration A on a database filled at the previous
migration, then does a handover the old way.

### Settings and snapshots (packages/core)

- `operatorSettingsSchema`: `handoverPhotos` removed; `conditionPhotoRule:
  z.enum(["optional", "required"]).default("optional")`, with the comment that
  it is copied onto each rental. (`fixedChargeWeekday` shows the other way, a
  field kept for old snapshots; not needed here because nothing reads the
  old list from a snapshot any more.)
- `conditionPhotoRuleOf(snapshot: StoredSettings)`: reads the **raw**
  snapshot, before Zod fills defaults: its `conditionPhotoRule` if present
  and valid; otherwise (a rental made before the change) `required`. This is
  the only place a snapshot's photo rule is read, because parsing an old
  snapshot with the new schema would give the new default, `optional`, which
  is wrong for it. Unit tests with an old snapshot, a new one, and a garbled
  value (throws, as `readSettings` does).
- `handoverGaps`: the named-photo gap is replaced by `{ kind: "photos" }` when
  the rule is required and no gallery photo is in use (decision 6); damage
  marks still need their photos. `handoverPhotoListSchema`,
  `photoListFromLines`, `DEFAULT_HANDOVER_PHOTOS` and `PhotoListForm` go.
- Settings screen: "Photos at pickup, return and swap", a choice of
  **Optional** and **Required: at least one photo** (shared radio piece), hint
  "New rentals use this; rentals already made keep theirs." Saved and logged
  as every setting (rule 19).

### The checklist (handover, return, both halves of a swap)

- Starting a checklist (`startChecklist`, `addSwapChecklist`): `photo_rule =
  conditionPhotoRuleOf(rental.settingsSnapshot)`, `photo_names = '{}'`.
  `handoverPhotoNames` goes.
- **Gallery** on the phone (mockups (8 Nov)): "Photos (7 of 30)", a grid of
  small copies in the order taken; **Take photos** (the in-app camera, which
  stays open for several shots) and **Choose from phone** (several at once).
  Each photo: its note (a short text box, opened with "Add note"), Remove,
  and a status (Saved / Waiting to send). A photo still waiting can be
  removed from the phone before it sends. Old named photos taken before the
  change, in a checklist that was under way then, show with their name as the
  note.
- **Uploads**: the phone gives each photo a key (`crypto.randomUUID()`) when
  it is taken. `startChecklistPhotoUpload` gets a new target `{ galleryKey,
  note }`: the server checks the checklist is in progress and the count is
  under 30, then, inside the same transaction, finds an earlier row with that
  key: confirmed means "already saved" (the phone drops its copy), pending
  means the same file and a fresh upload permission. So a photo sent twice on
  patchy signal is kept once (the index is the last word).
- **Confirm**: as today (content checked from the bytes, only checked bytes
  moved), plus for gallery photos the checklist row `FOR UPDATE`, the count,
  and the SHA-256 of the whole stored photo (decision 9; about 400 KB read
  once, at confirm, never again).
- **Notes**: edited while in progress (`UPDATE photo_note`, logged as "photo
  note changed" without the text, rule 7: notes may name people). Never
  written to logs or errors.
- **Remove**: marks the photo and its small copy deleted (as a retake does
  today), logged; refused once finished (trigger). Restoring a photo removed
  from a checklist isn't offered (the checklist is the place to retake it).
- **Old queued photos** (a phone mid-handover at the deploy, holding
  `{photoName}` targets): the server still accepts a named target for a
  checklist whose `photo_names` has that name, and stores it as today; the
  gallery shows it with its name. Nothing a phone has queued is lost.

### Offline (rule 25)

- The queue gains three kinds, all keyed by the photo's key so every send is
  safe to repeat: `photo` with target `{ galleryKey }` and its note; `note`
  (`galleryKey`, the new note); `remove` (`galleryKey`). Oldest first, as
  today; a `note` or `remove` for a photo still in the queue just changes or
  drops the queued photo on the phone.
- Dexie: a version 2 with the same tables (the new kinds need no new index);
  version 1 entries stay readable.
- **New guard: the Renter can't sign while anything is waiting** on that
  phone for that checklist. Today a waiting named photo is a gap the server
  sees; a waiting gallery photo isn't, and would be refused (and lost) once
  the report is signed. The signing step shows "3 photos still sending: wait
  for signal, or remove them" and stays closed until the queue is empty.
- **Two phones**: if the report is signed on phone B while phone A still has
  photos waiting, A's photos are refused by the checklist (as today). Instead
  of dropping them silently, the server keeps them as "Other photos" of the
  car (decision 10): a new upload target `{ lateFor: inspectionId }` that
  records them with no `inspection_id` and a label "taken during the pickup on
  Tue 3 Nov, after it was signed". Phone A says so in plain words.
- Phone storage: 30 photos and small copies are about 13 MB on the phone;
  the existing wipe on finishing and after 7 days applies unchanged.

### Signed reports (rule 12)

- **Fingerprint** (`checklistFingerprint`): gallery photos in order as
  `[fileId, thumbnailFileId, note]`, plus the named photos as now (for a
  checklist under way at the change) and damage marks. A note edited, a photo
  added or removed on another phone after the screen showed it, and the
  signing is refused as "changed" (existing message).
- **What the Renter sees before signing** (`AcceptanceSummary`): adds
  "Photos: 12 (above)" so the count they sign to is on screen; the gallery
  is on the same page above it.
- **Rendering**: "Photos at pickup (12)": each photo's small copy, captioned
  "Photo 1", or "Photo 3: scratch by the fuel cap", or an old photo's name;
  then damage photos as now. None taken: "No photos were taken." (decision 7).
- **Return report** (decision 5): "Photos at pickup (Tue 3 Nov)" from the
  handover it compares with (`loadCompletedHandover`: the rental's own, or
  the swap that brought this car), then "Photos at return", then new damage.
  Old named handovers print with their names.
- **Fingerprints page**: after the signature, a short list "Photo 1 …
  4f2a9c1e" (the first 8 characters of each full-size photo's SHA-256; the
  full codes are on the file records). Photos from before decision 9 have
  none and say so.
- **"Missing photo stops report"**, after this change:
  1. *Named photo not taken* no longer exists. Required now means at least
     one gallery photo (app check and database trigger); Optional means
     none needed.
  2. *Taken photo that can't be put in the PDF* still stops the signing,
     unchanged (`ReportPhotoMissingError`, one retry, WebP note for old
     photos). Shown equals signed is kept: every photo in the gallery when
     the Renter signs is in the PDF.
  3. *New*: a photo still waiting on the phone stops the signing on that
     phone (offline guard above).
- Size: 400 px small copies are about 30 to 50 KB; two albums of 30 plus
  damage photos are about 2.5 MB, well under the 10 MB limit for issued
  documents. The time to make the PDF with 60 pictures is measured in a test
  and recorded in the commit; if it is too slow for the phone's wait, the
  small copies are fetched in parallel (they already are, `Promise.all`).

### Compare at return

- The return checklist page loads the pickup album of the handover it
  compares with (as above) and shows it in a closed-by-default section "At
  pickup, Tue 3 Nov (12)" above the return gallery on a phone, beside it on a
  computer; tapping a photo opens the full-size viewer (`ImageViewer`), where
  pickup and return photos can be flipped through together. Damage marks from
  pickup are shown on the outline as today.
- Swaps: the old car's return compares with the handover that brought that
  car to the rental.

### Albums

- `listConditionAlbums(deps, operatorId, scope)`, scope `{ vehicleId }` or
  `{ rentalId }`, inside `withTenant`: one row per checklist (kind, swap or
  not, status, finished or started time, the rental, the Renter's display
  name, the rego), its photo count and its first photo's small copy, from
  `files_inspection_idx` and `files_thumbnail_of_idx`; plus one per damage
  record with photos ("Damage · scratch on rear bumper · Tue 3 Nov") and one
  "Other photos" (loose photos and decision 10's late ones). Newest first, 12
  at a time with "Show more". Photos of one album load only when it is opened
  (signed 5-minute links for its small copies).
- Album names: "Pickup", "Return", "Swap · car returned", "Swap · car taken",
  each with the date and the Renter (a business rental: the business and
  driver). Cancelled checklists with photos show as "Pickup (not finished)".
  A finished album links to its signed report (Open PDF).
- **Car page**: the Photos tab renamed **Condition photos** (`?tab=photos`
  still opens it), the albums as cards (cards on phones, a grid on computers,
  one tap per card). No upload button (decision 8).
- **Rental page**: a **Photos** tab (Overview, Money, Papers, Photos, Log)
  with the rental's albums, across cars after a swap.
- Damage records keep their own photos as now; their album is a view.

### Lifecycle and storage (rules 21 to 23)

- Each photo stored once (about 1600 px, about 400 KB) plus one 400 px small
  copy (rule 21); reports embed the small copies.
- Upload checks unchanged (rule 22): images only, size cap per kind, type
  checked from the bytes.
- **Glacier after a year** (rule 23): gallery photos are found by
  `inspection_id` like named ones. **Fix** in slice 4: the job and
  `app.operators_with_photos_for_long_term_storage` also take each due
  photo's small copies (by `thumbnail_of_file_id`), which today are never
  moved (finding above). Damage record photos and "Other photos" keep their
  current treatment (not moved), noted for the lawyer's retention review.
- Removed while under way: binned, purged 30 days later. Finished checklist
  photos can't be removed (evidence). Retirement bins them with the rental's
  other records and blanks notes (Migration A step 10).
- Storage used per Operator: counted as today. More photos per checklist
  means more storage (typical 10 photos is about 4.5 MB; the cap 13 MB).

### Tenancy and security

- Every query in `withTenant`, scoped by the session's Operator; checklist,
  photo and key look-ups all include `operator_id`; two-column links already
  stop a photo pointing at another Operator's checklist.
- The client key is only matched within the same Operator and checklist, so a
  guessed key can never reach another's photo.
- Notes and photos never logged (rule 7); admin has no access to notes or
  photos (rule 5).
- No new session-less job; the Glacier job is unchanged in how it sets each
  Operator's context (rule 3).

### Tests

- **Core**: `conditionPhotoRuleOf` (old snapshot gives required; new gives its
  value; garbled throws); `handoverGaps` with optional, required, none, one,
  damage-only (decision 6).
- **Database**, on a database filled at the previous migration then migrated:
  old finished checklists have a null rule and are unchanged (row by row);
  in-progress ones are required; an insert the old way gets required; the
  old code's named-photo handover still completes. Triggers: a note can't
  change after finishing or cancelling; the 31st gallery photo is refused;
  two confirms of the 30th and 31st at once (one refused); a required
  checklist can't complete with no photo; one key, one photo. Settings: every
  Operator has `conditionPhotoRule = required`, versions bumped, logged;
  every unfinished old rental has its Log line.
- **Signing**: fingerprint changes when a photo is added, removed or its note
  edited on another phone (refused as changed); a photo that can't load stops
  the report; the report lists every photo in order with notes and the "no
  photos" line; old named checklists' reports are byte-for-byte unchanged
  (their PDFs are never remade, and their stored hashes still match).
- **Offline**: a photo sent twice is kept once; queued note and remove
  repeat safely; signing is refused while the queue has photos; old
  `{photoName}` queue entries still send; late photos land in Other photos.
- **Tenant isolation**: A can't list B's albums, send a photo to B's
  checklist (by id or by key), or read B's notes.
- **Retention**: retirement blanks notes; the Glacier job moves small copies
  (fails before the fix, passes after).
- **Browser** (`handover.e2e.ts`, `swap.e2e.ts`, `car-pages.e2e.ts`,
  `rental-page.e2e.ts`): gallery take, note, remove; offline then back; sign
  blocked while sending; compare at return; Settings choice; Condition photos
  albums; rental Photos tab; keyboard only, 375 px and computer, axe,
  budgets (the handover page's budget measured again; the gallery reuses the
  existing camera and viewer).

### Legal (to docs/legal-notes.md as each slice lands)

- **Evidence value**: the signed report (PDF with SHA-256, rule 12) is the
  record the Renter agreed to; the per-photo SHA-256 (decision 9) ties each
  full-size photo to it, so a dispute can use the full photo, not only the
  printed small copy. Photos are made on the business's phone and stored as
  sent; the server's time of arrival (not the phone's clock) is what is kept.
  Optional photos (the new default) weaken an Operator's damage evidence:
  the checklist warning (decision 7) says so, and the privacy and terms notes
  should suggest Required for businesses that recover damage costs. Ask the
  lawyer whether a Renter's signature over a report with no photos limits a
  later damage claim.
- **Privacy (APPs 3, 6, 11)**: more photos can mean more people, other plates,
  homes or belongings caught. The gallery hint: "Photograph the car. Keep
  people out of the photos." Notes are free text that may name people: never
  logged, blanked at retirement, never seen by AGS staff. Kept in S3 Sydney
  (overseas table unchanged). Kept on the phone up to 7 days as today.
- **Consumer law**: unchanged; the Renter still signs to the condition shown.
- **Record keeping**: unchanged periods (Glacier after a year; retirement at
  seven years; damage photos held while a charge or claim is open). The
  lawyer's retention review (already listed) should cover "Other photos".
- No Spam Act change (reports are transactional, as now).

### Slices (each small, reviewed, on the dev site before the next)

1. **Foundations, no visible change.** Migration A; `conditionPhotoRuleOf`;
   new checklists store their rule (required for every rental so far) but
   **still copy the named list and use today's screen**, so handovers keep
   working until slice 2; retirement blanks notes. Deep review (snapshots,
   signing triggers, migration on a filled database), two checkers.
2. **The free gallery.** Settings schema switch (`handoverPhotos` out,
   `conditionPhotoRule` in) and the Settings choice; new checklists store
   `photo_names = '{}'`; gallery on handover, return and both halves of a
   swap; uploads with keys, notes, remove; offline queue and
   the signing guard; late photos; fingerprint, acceptance summary, report
   and return report rendering with per-photo SHA-256; compare at return.
   Mockups first. Deep review (signing and evidence), two checkers.
3. **Albums.** Condition photos tab (renamed, no upload), rental Photos tab,
   damage and Other photos albums. Mockups first. Quick review plus tenancy
   tests.
4. **Glacier fix.** Small copies moved with their photos; test first.
   Quick review.

### Test sheet rows (numbered when built, from the next free O- number)

New: Settings "Photos at pickup, return and swap" choice; gallery (take
several, choose from phone, note, remove, 30 limit); waiting photos block
signing; no-photos warning (Optional); Required with no photo blocked; report
shows gallery photos with notes and the fingerprints page; return report
pickup then return; compare at return; swap galleries; late photos in Other
photos; car Condition photos tab and albums; rental Photos tab; damage and
Other photos albums. Changed (Result back to "Not tested"): Settings handover
photo list (replaced), handover checklist photos, return photo pairs, car
Photos tab, offline handover rows. No admin rows.

### Out of scope

- Showroom photos (docs/plans/find-a-car.md).
- Renter return-photo links (docs/design/05, later).
- Suggested shot lists or guided angles.
- Video.

### Self-review (senior engineer pass) and fixes made

- **Old snapshots read with the new schema would turn Optional**: found that
  `readSettings` fills missing keys with today's default. Fixed by reading
  the rule from the raw snapshot (`conditionPhotoRuleOf`), old means required,
  tested.
- **Old deployed code during the deploy**: inserts checklists without a rule
  and with names. Fixed by a default that applies only to new inserts and by
  keeping named photos accepted; existing finished rows untouched (column
  added with no default, no trigger fired).
- **Finished checklists changed by a backfill**: avoided; only in-progress
  rows are updated, which the immutability trigger allows. Snapshots are
  never rewritten; rule 14's "explicit, logged change" is met by a Log line
  per affected rental (decision 1).
- **Duplicates on patchy signal**: gallery photos had no idempotency (named
  photos replaced themselves). Fixed with the phone's key and a unique index.
- **Photos lost at signing**: a photo waiting on the phone wasn't a gap any
  more and would be refused after signing. Fixed by the signing guard, and by
  keeping late photos from another phone (decision 10).
- **Over the cap by racing confirms**: confirm locks the checklist for
  update; a trigger counts.
- **Notes after signing**: trigger refuses changes once completed or
  cancelled; notes are in the fingerprint.
- **Evidence strength of full-size photos**: only the PDF was hashed. Fixed
  by per-photo SHA-256 set once at confirm (decision 9).
- **Required with only a damage photo**: defined (decision 6), enforced in
  the app and the database.
- **Return report pairing by name**: no names any more; pickup album then
  return album; old named handovers still print their names.
- **Glacier small copies**: existing bug found; fixed with a test (slice 4).
- **Retirement**: new free text (notes) blanked; files already binned.
- **Tenancy**: every new look-up includes the Operator; keys scoped to one
  checklist; no admin grants.
- **Two meanings of "Photos" on the car page**: resolved by Showroom (other
  plan) and Condition photos, and old loose photos kept private (decision 8).
