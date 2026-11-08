# Find a car and Showroom photos

Status: **draft for Abhi's approval (8 Nov 2026).** Nothing is built until he
says go, slice by slice. It touches schema (a new kind of car photo, a car
tick if decision 9 is yes) and the booking path (which cars can be chosen for
which dates), so CLAUDE.md asks for a plan first. Source: Abhi's decisions of
8 Nov 2026 (1) and (2). Mockups are being drawn on the design canvas: they are
called "mockups (8 Nov)" here, and every new screen waits for them (rule 34).
Design docs read: 02 (Vehicles), 04 (Rentals), 08 (Shared services). Rules 1,
2, 14, 18, 21 to 24, 28 to 34 apply throughout. The sister plan
docs/plans/condition-photos.md covers decision (3) (pickup and return photos);
the two meet on the car's page (see "Order with the condition photos plan").

---

## What this means for you

- **New rental starts with "Find a car".** You say when (start, and an end or
  Ongoing), what kind of car (body type) and the budget ("up to $X a week").
  The app then shows **only the cars that are free for those dates**, as
  photo cards, like a car-dealer or JB Hi-Fi listing.
- On a computer, filters sit down the left: body type, make, price a week,
  seats, gearbox, fuel, year, kilometres, rideshare-ready (if you say yes to
  decision 9) and a search box. On a phone they open from a **Filters**
  button as a panel from the bottom. Sort by lowest price, newest or lowest
  kilometres.
- Each card shows the car's photos (flip through them), the year, make and
  model, one line of details ("Automatic · Petrol · 5 seats · 45,210 km"),
  the rego and the price a week.
- Cars already booked for those dates are **not** in the list. Under it, a
  closed section "Booked for these dates (3)" lists them with when each is
  next free. You can look, but not choose them.
- Tap a card to see its photos large and its details, then **Choose this
  car**. The rest of the New rental form opens with the car and dates filled
  in (the Renter, prices, bond and so on as today).
- **"New rental for this car"** on a car's page skips the search: the car is
  kept, and as soon as you type dates that clash, a warning shows under the
  dates with when the car is free.
- The database rule that stops a car being booked twice (rule 18) stays the
  real guard. If someone books the car in the seconds between you looking and
  saving, you're told plainly and nothing is double-booked.
- **Each car gets a "Showroom" tab** with its best photos: as many as you
  like, no categories, each with an optional name you can change any time;
  you put them in order and star the main one (the one on its card). These are separate from
  the pickup and return photos, which stay private (the other plan).
- Later, the same page can become each business's online booking page for
  Renters. That is not built here, but everything is shaped so it can be.

### Decisions you need to make

Each has my recommendation and the main tradeoff. Say yes, or push back.

1. **New rental always starts with Find a car**, with a small "I know which
   car" link that goes straight to the form and its car picker. Recommend:
   yes. Tradeoff: one extra step when you already know the car; in return
   nobody picks a car that's booked or in the workshop by mistake. (From a
   car's page or a free spot on the calendar, the car is already known, so
   the search is skipped.)
2. **The price on cards is the price a week**: the car's long-term weekly
   price, or seven times its daily price when it has no weekly price. For a
   short hire (shorter than your "long-term from" setting, 7 days by
   default) the card also shows the daily price and the total for those
   days ("or $60/day · $300 for 5 days"). The budget always compares the
   weekly price. Recommend: yes. Tradeoff: a short hire's main number isn't
   what it costs; in return every card compares on one number, as Abhi asked.
3. **Cars with a detail not filled in** (body type, gearbox, fuel and seats
   are optional today) show normally until you filter on that detail. Then
   they're hidden, and a line says "2 cars hidden: body type not filled in ·
   Show them". The car's page says what's missing for Find a car. Recommend:
   yes. Tradeoff: a filtered list can miss a car until its details are
   filled in; in return the filters never guess.
4. **Cars in the workshop**: if it's expected back after the start, it's in
   the not-free section ("In the workshop, expected back Mon 9 Nov");
   if it's expected back before the start, it's in the list with a small note
   ("In the workshop until Mon 9 Nov"). Recommend: yes. Tradeoff: an expected
   date is a guess, so a late workshop can still spoil a booking (the
   dashboard already flags late ones); in return you can book ahead for a
   car that's being serviced.
5. **A car still out past its return date counts as not free** until it's
   back ("Still out, was due back Tue 3 Nov"), whatever dates you ask for.
   Recommend: yes. Tradeoff: none worth noting; today the booking form would
   let you book it from its old return date, and the handover would then be
   refused.
6. **The starred main photo is always the first.** Starring a photo moves it
   to the front. Recommend: yes. Tradeoff: you can't have a main photo that
   isn't first; in return the order and the main photo can never disagree.
7. **The Showroom starts empty for every car.** Photos already on a car's
   Photos tab stay private (they become condition photos in the other plan).
   Recommend: yes. Tradeoff: you add your best photos to the Showroom once;
   in return a pickup photo (which may show a Renter or someone's house) can
   never end up on a card or, later, a public page.
8. **No limit you'll see, no categories** (Abhi, 8 Nov): add whatever
   photos you want (five of the front and one inside is fine). Each can have
   an optional name ("Front", "Boot space") that you can change at any time;
   it is also what a screen reader says for the photo. Behind the scenes a
   quiet safety cap of 100 photos a car protects page speed and storage, and
   is mentioned only if reached. Each photo's card copy is kept sharper than
   a pickup photo's small copy, so cards look crisp on a phone. Recommend:
   yes. Tradeoff: about 0.5 MB stored per photo (tracked per business, rule
   23); in return cards look like a dealer's.
9. **(Open proposal) A "Rideshare-ready" tick on each car**, set by you on
   the car's form, and a "Rideshare-ready only" filter. Recommend: yes, a
   tick you set, **not** guessed from the car's year or seats. Tradeoff: one
   more thing to keep up to date per car; in return the app never claims a
   car is rideshare-ready when it isn't. Why not guess: Uber's own pages say
   the rules differ by state and platform (in Victoria the car must be
   registered as a commercial passenger vehicle and inspected yearly; in
   Sydney a 5-star safety rating and an age limit), and they change. Only you
   know your rego and insurance cover rideshare use.
10. **Default sort: lowest price.** Recommend: yes. Tradeoff: none worth
    noting; the sort is one tap to change and the app remembers it in the
    address while you browse.

---

## Technical detail (for the builder)

### What the code does today (findings)

- **New rental** (`apps/web/src/app/rentals/new/page.tsx`): one form
  (`rental-form.tsx`, budget 510 KB) with a Renter picker and a car picker
  (`listPickableCars` in `lib/rentals/pickable-records.ts`: every current car
  except sold and written off, by rego, no dates). Presets `renterId`,
  `vehicleId` and `startsOn` come from the address (`NEW_RENTAL_PRESETS`,
  `newRentalPath`). Choosing a car fills the price boxes from
  `listCarPrices`.
- **Double booking**: `car_holds` with `held_during tstzrange` and the
  exclusion rule `car_holds_no_overlap` (operator, car, range) where
  `released_at is null` (0028). Drafts hold no car; booking holds; ongoing is
  open-ended (`heldRange(start, null)`); a return or cancellation releases
  the hold; an early handover moves the hold's start. `findBookingClash`
  asks before writing; `isCarAlreadyHeld` turns the database's refusal into a
  message. `possessions` has its own exclusion rule.
- **Gap found**: an active rental past its planned end keeps its hold only
  to the planned end, so the form can book that car from then although the
  car is still out (the next handover is then refused by the possessions
  rule). Find a car fixes this for searching (decision 5); the form's own
  check gets the same rule (slice 3).
- **Cars** (`packages/db/src/schema/vehicles.ts`): `make`, `model`, `year`
  required; `variant`, `colour`, `body_type`, `transmission`, `fuel_type`,
  `seats` nullable. Prices: `daily_rate_cents` (nullable: "old cars have
  none"), `long_term_weekly_cents` (nullable: "none means seven daily
  rates"). Odometer is the latest counted reading (`latestKilometres`,
  index `odometer_readings_vehicle_idx`). Status `in_service` / `off_road`
  carry `status_reason` and `status_expected_back` (a date).
- **Car photos today**: one kind, `vehicle_photo` (+ `vehicle_photo_thumbnail`,
  400 px). The Photos tab lists every photo of the car together: those
  uploaded on the tab, checklist photos and damage photos
  (`listCarPhotos` in `lib/files/car-files.ts`). Photos are shrunk on the
  phone to about 1600 px (`shrinkImage`, JPEG 0.85) and a 400 px small copy
  (`THUMBNAIL_EDGE_PX`), with the location data dropped by the redraw
  (rule 21). Uploads go to `incoming/`, are checked from their first bytes
  (`detectFileType`) and only then moved to their own address (rule 22).
  Removed files are kept 30 days and can be restored (rule 23). Storage used
  per Operator is summed from `files.size_bytes` in the admin app.
- **Shared pieces we can use**: `Drawer` (Base UI, bottom on phones, right on
  computers), `ImageViewer` (yet-another-react-lightbox), nuqs for filters in
  the address, `MoneyInput`, `Select`, `Checkbox`, `FormField`,
  `RecordStrip`, `RowLink`, `TabLinks`, `FilePicker`, `CameraCapture`.

### Data model

#### Showroom photos: a kind of file of their own

Recommendation: two new file purposes, **`vehicle_showroom_photo`** and its
small copy **`vehicle_showroom_thumbnail`**, rather than a flag on
`vehicle_photo`. Why:

- A pickup or damage photo is evidence and may show people, other plates or
  a home; a Showroom photo is meant to be seen (by Renters later). Keeping
  them as different kinds means no query, export or future public route can
  mix them up by forgetting a flag, and the stored address already carries
  the kind (`{operatorId}/{purpose}/{fileId}`, `buildFileKey`).
- Their lifecycle differs: Showroom photos are never moved to Glacier (they
  are shown on every search) and are not tied to a rental or a Renter's
  retirement.

Migration (next free number; backwards compatible with the code already
deployed, as every migration must be, progress.md "Open items"):

1. `ALTER TYPE file_purpose ADD VALUE 'vehicle_showroom_photo'` and
   `'vehicle_showroom_thumbnail'`. Every check below compares purposes as
   text, as the existing checks do, because Postgres won't use a new enum
   value in the migration that adds it.
2. `files.showroom_position smallint`, nullable. Check
   `files_showroom_position`: `(purpose::text = 'vehicle_showroom_photo') =
   (showroom_position is not null)` and `showroom_position >= 1`. Position 1
   is the main photo (decision 6). Not unique in the database (a partial
   unique index can't be deferred, and a reorder rewrites several rows); the
   app rewrites positions 1..n in one transaction holding the car's row
   `FOR UPDATE` (as `nextPhotoName` does), and lists order by
   `(showroom_position, created_at)` so even a slip can't hide a photo.
3. Checks widened (dropped and re-added in the same migration):
   - `files_vehicle_purposes`: the two new kinds need `vehicle_id`; the
     small-copy rule becomes `(purpose in ('vehicle_photo_thumbnail',
     'vehicle_showroom_thumbnail')) = (thumbnail_of_file_id is not null)`;
     the label rule is unchanged (Showroom photos have no label: nothing is
     downloaded by name from a card, and `files_one_photo_name_per_car`
     stays for condition photos only).
   - `files_inspection_photos` and `files_damage_record_photos` already allow
     only `vehicle_photo` on a checklist or damage record, so a Showroom
     photo can never be evidence, and evidence can never be a Showroom photo.
3b. `files.caption text`, nullable: the photo's optional name (decision 8),
   shared with condition photos (docs/plans/condition-photos.md; whichever
   migration lands first adds it, the other only widens its check). Check:
   1 to 80 characters (`MAXIMUM_PHOTO_CAPTION_LENGTH`), only on
   `vehicle_photo` or `vehicle_showroom_photo`. `UPDATE (caption)` grant.
   Renames are logged without the text (rule 7). Not the system `label`.
4. Trigger `files_thumbnail_matches` (BEFORE INSERT): a
   `vehicle_showroom_thumbnail` must point at a `vehicle_showroom_photo` and a
   `vehicle_photo_thumbnail` at a `vehicle_photo`, of the same Operator and
   car. Cheap, and stops a small copy of a private photo being served as a
   card picture.
5. Index `files_showroom_idx (operator_id, vehicle_id, showroom_position)
   WHERE purpose = 'vehicle_showroom_photo' AND confirmed_at IS NOT NULL AND
   deleted_at IS NULL`: the card list reads each car's first photo in one
   query (`DISTINCT ON (vehicle_id)`).
6. Grants: `UPDATE (showroom_position)` on `files` to `web_app_role`.
   Nothing for the admin roles beyond what they already read (size and dates,
   for storage used).

`packages/core/src/files.ts`:

- `FILE_PURPOSE_RULES`: `vehicle_showroom_photo` general storage, JPEG/PNG
  (`PRINTABLE_PICTURE_TYPES`, so it can go on a PDF later), 5 MB, "a photo";
  `vehicle_showroom_thumbnail` general, JPEG/PNG, 1 MB.
- `VEHICLE_FILE_PURPOSES` gains both. `MAXIMUM_SHOWROOM_PHOTOS = 100`, a
  quiet safety cap (decision 8: never shown unless reached), checked when the
  upload is asked for and again under the car lock when it is confirmed (two
  phones at once can't make 101). At 100 the tab says "This car already has
  100 Showroom photos, the most it can hold." Why 100: the preview page lists
  every photo (loading each small copy only as it scrolls into view); 100
  keeps that list and the car's storage (about 50 MB) bounded.
- `SHOWROOM_CARD_EDGE_PX = 800` next to `THUMBNAIL_EDGE_PX` in
  `packages/ui/src/lib/shrink-image.ts`. Why 800: a card is about 343 px wide
  on a 375 px phone, and phones show 2 to 3 screen dots per pixel; 400 px
  looks soft, the 1600 px photo is about 400 KB per card. 800 px is about
  80 to 120 KB. Rule 21 still holds: one photo of about 1600 px plus one small
  copy, each stored once.

Not changed: the identity storage (rule 8; Showroom photos are general), the
upload steps (`requestUpload`, `confirmUpload`: content checked from the
bytes, only checked bytes moved), removal and restore (30 days), abandoned
upload clean-up, the storage-used sum (new kinds counted automatically; the
admin page may later split "Showroom" and "Condition", not needed now).

#### Car details for Find a car

- Nothing becomes required: existing cars would fail their next edit.
  Decision 3 handles "not set". The car form gains a short note "Used by Find
  a car" over the details, and the car's Overview gets a line "For Find a car,
  add: body type, seats" while any of body type, transmission, fuel or seats
  is empty, or the car has no Showroom photo or no price.
- **Rideshare-ready** (decision 9, only if approved): `vehicles.is_rideshare_ready
  boolean NOT NULL DEFAULT false` (a constant default fills every row at once,
  no rewrite; old deployed code never sets it, so new cars from it are
  unticked, which is the truthful answer). `UPDATE (is_rideshare_ready)`
  grant. Checkbox on the car form (packages/ui `Checkbox`), hint "Tick when
  this car meets the rideshare companies' rules and its rego and insurance
  cover rideshare use." Logged with every car change (rule 19). Shown on the
  card's details line as "Rideshare-ready".

#### Price

`weeklyPriceCents(car) = long_term_weekly_cents ?? (daily_rate_cents * 7)`,
null when the car has neither (shown "No price set", sorted last, hidden by a
budget filter with the "hidden" line of decision 3). A pure function in
`packages/core/src/vehicles.ts` (integer cents, rule 9; tests). The daily
price and the short-hire total come from the existing block rules
(`blocksBetween`, `isLongTermBooking` in `rent-blocks.ts`, with the
Operator's current `graceMinutes` and `longTermMinimumDays`), so Find a car
and the booking form can never disagree about what counts as a short hire.
The rental still copies its own prices when made (rule 14): the card shows
the car's list price; the form still lets the Operator change it.

### Availability (the heart of it)

One pure function in `packages/core/src/availability.ts`:

```
carAvailability(span, car, busy[], now) -> Free | Free with note | Not free (why, next free)
```

where `span` is `[start, end)` or `[start, ∞)` for ongoing, and `busy[]` is
the car's live holds, its open possession, and its workshop stretch.

- **Free**: no live hold overlaps the span, no open possession, and not in
  the workshop past the start.
- **Free with note**: in the workshop, expected back on or before the start
  (decision 4).
- **Not free**, with the reason and the next free moment:
  - a live hold overlaps: "Booked until Fri 13 Nov" or "On an ongoing
    rental" (upper bound open);
  - an open possession past its planned end: "Still out, was due back Tue 3
    Nov" (decision 5), next free unknown;
  - in the workshop, expected back after the start.
  - "Next free" is the first moment at or after the asked start from which
    the car is clear for the asked length (or, for ongoing, clear with no
    later hold), found by walking that car's holds in order. A fixed span
    that fits only partly says "Free until Mon 23 Nov only" (useful for an
    ongoing request where a booking follows).
- All instants are UTC; the dates are typed in the Operator's timezone and
  converted with the existing `requiredLocalMoment` helpers (rule 10), shown
  back with the friendly date format.

One data function in `apps/web/src/lib/rentals/find-a-car.ts`, taking the
Operator id explicitly (from the session today; from trusted booking-page data
later, rule 3), inside `withTenant`:

1. The Operator's current cars (`archived_at is null`, not sold or written
   off), with price, details, latest odometer (lateral on
   `odometer_readings_vehicle_idx`) and first Showroom photo (on
   `files_showroom_idx`).
2. The live holds overlapping `[start, ∞)` (not just the span: next free
   needs the ones after it), with `released_at is null` written in the query
   so the exclusion rule's own index (operator, car, range, partial) is used,
   and the open possessions (`ended_at is null`).
3. `carAvailability` for each car, then filters, counts and sort in core
   (`findCarResults`), then the page of 24 cards.

**Why filter and count on the server in code rather than in SQL**: a fleet is
tens to a few hundred cars, so reading them all is two small indexed queries
(well under 50 ms at 500 cars, to be measured in a test with 500 cars and
5,000 holds); facet counts ("Hatch (4)") for every filter at once are simple
in code and fully unit-tested; and the same core function will serve the
public page. If a fleet ever passes about 2,000 cars, move the facet counts
into SQL (noted, not built).

What the result never holds: a Renter's name or any rental detail beyond
"booked until". That keeps it safe to reuse on a public page. The Operator's
own view adds a link to the clashing rental only in the not-free section.

### Screens (mockups (8 Nov) first, rule 34)

1. **Find a car, step 1** (`/rentals/new`): dates (start, then end or the
   Ongoing switch, the shared date and time picker), body type (chips, "Any"),
   budget (`MoneyInput`, "Up to $ a week", digits and commas as typed, rule
   31). Required: start, and end unless Ongoing (red asterisks,
   `RequiredFieldsNote`, the same Zod schema as the server, rule 28). "I know
   which car" link (decision 1). A Renter preset (`renterId`, from "New
   rental for Sam") is carried through every step.
2. **Results** (`/rentals/new/cars?start=…&end=…|ongoing=1&body=…&max=…`):
   - Computer: filter sidebar on the left; phone: a **Filters** button with
     the count of filters in use, opening the shared `Drawer` from the bottom
     (Show N cars, Clear all).
   - Filters: body type, make (each with counts), price a week (min and max,
     money boxes), seats (at least), transmission, fuel, year (from, to;
     `Select`s of years present), kilometres (up to: 25,000 steps, `Select`),
     rideshare-ready (decision 9), keyword (rego with spaces and capitals
     ignored, make, model, variant, colour; parameterised, wildcards in the
     typed text escaped). All in the address with nuqs and checked again by
     Zod on the server (rule 1: they only narrow the Operator's own cars).
     Selects rather than sliders: easier with a thumb and a keyboard, and
     read out plainly.
   - Sort (`Select`): lowest price (decision 10), newest (year, then
     newest added), lowest km (no reading last).
   - "12 cars free for Mon 10 Nov to Mon 17 Nov" (spoken by a polite live
     region when it changes) and the "hidden" line of decision 3.
   - Cards (a list; a grid on a computer, one column on a phone): photos in
     a sideways strip with CSS scroll-snap (swipe on a phone; previous and
     next buttons on a computer, shown on hover and on keyboard focus, "Next
     photo of 1ABC234, 2 of 6"), then "2022 Toyota Corolla", the details line
     ("Ascent Sport · Automatic · Petrol · 5 seats · 45,210 km"; missing parts
     left out), the rego (bold teal, rule 34) and the price ("$350/wk", plus
     the short-hire line of decision 2). The whole card opens the preview
     (the shared stretched-link `RowLink` pattern: one tap on a phone, no
     links inside links). No photo: the car outline and "No photo yet".
   - **Booked for these dates (N)**: a closed disclosure (Base UI
     Collapsible) under the list; each row the rego, car and "Booked until
     Fri 13 Nov · free from 10:00" (or the workshop or still-out reason), no
     choose button. The rego opens the car's page.
   - Empty: "No cars free for these dates." with "Change dates" and the
     booked section open.
3. **Preview** (`/rentals/new/cars/[vehicleId]?…same search…`): navy strip
   (rule 34) with the rego, year make model and the price; the photos large
   (tap for the full-size viewer, `ImageViewer`); details card (all fields,
   "Not filled in" where empty); **Choose this car** (navy, full width on a
   phone) and "Back to results" (keeps the search). If the car stopped being
   free since the list loaded, the preview says so and offers Back instead
   of Choose.
4. **The New rental form** (`/rentals/new?vehicleId=…&start=…&end=…`): as
   today, the car shown as chosen (with "Change car", back to the results),
   dates and prices filled in. Business Renters slice 3's driver picker sits
   in this form unchanged.
5. **"New rental for this car"** (car page, calendar free spot): the form
   with the car fixed. As the dates are typed (0.3 s after the last change)
   a server action runs `carAvailability` for that car and shows, under the
   dates, "Booked Tue 3 Nov to Fri 13 Nov. Free from Fri 13 Nov, 10:00." or
   the workshop or still-out reason; Save still refuses with the existing
   clash message, and the database rule has the last word.
6. **Car page, Showroom tab** (new, second after Overview; the old Photos tab
   is renamed "Condition photos" by the other plan; an old `?tab=photos`
   opens Condition photos): the photos in order, the first with a "Main"
   label and a filled star; per photo: its name (tap to add or rename, any
   time), Make main, Move earlier, Move later, Remove (30 days to restore, as
   today). No slots or categories. Add photos (`FilePicker`, several
   at once, or the camera), each shrunk on the device to 1600 px plus an
   800 px card copy. Hint: "Your best photos of this car, for Find a car.
   Keep people, other cars' plates and homes out of them." No limit is
   shown.
   Reordering is by buttons, not dragging: they work with a keyboard, a
   screen reader and one thumb; a drag library (dnd-kit) is not added unless
   Abhi asks for dragging (rule 32: nothing is rebuilt; the buttons are the
   control).

Every list that today says "New rental" (Home, Rentals, Calendar, a Renter's
page) now opens step 1; a car's page and a calendar free spot open the form
for that car.

Formatting (rule 31): budget and prices with the shared money box; kilometres
with commas; rego capitals; year digits only (4). Keyword is free text (no
format fits: it searches several fields).

### Accessibility (rule 33, WCAG 2.2 AA)

- Filters are a form with fieldsets and legends; counts are part of each
  option's name ("Hatch, 4 cars"). The phone sheet is the shared Drawer
  (focus kept inside, Escape and Back close it, focus returns to Filters).
- Cards: each has a heading; the photo strip is a group named "Photos of
  1ABC234" with its position spoken; `prefers-reduced-motion` turns off the
  smooth scroll. The stretched link is the card's name; flip buttons sit
  above it, 44 px.
- Status words in the not-free section differ in lightness, not only colour
  (rule 34). Contrast of text over photos avoided: no text on the photo.
- Alt text for Showroom photos: the photo's name with the rego ("Boot
  space, 1ABC234, photo 2 of 6"), or "1ABC234, photo 2 of 6" when unnamed.

### Download size (rule 33)

- Step 1: the date picker and money box only; budget set at measured +10%
  (expected well under the form's 510 KB, as it has no pickers of Renters).
- Results: target 220 KB (the Cars list is 190 KB; the Drawer and Selects are
  shared). The photo strip is CSS with a few lines of script, no carousel
  library. The full-size viewer loads only when opened (as on the car page).
- Pictures are not script but matter on a phone: only each card's first photo
  loads, lazily, with its width and height set (no jumping); the others load
  when flipped to. 24 cards a page, "Show more".
- The car page's 500 KB budget is checked again with the Showroom tab.

### Tenancy and security

- Every query inside `withTenant`, scoped by the session's Operator; car ids
  in the address are only trusted after the scoped look-up finds them (an id
  of another Operator's car gives "not found", never their data).
- Holds and possessions are read only for the Operator's own cars
  (two-column links already make cross-Operator rows impossible).
- Showroom photos are served as today: 5-minute links made after the scoped
  look-up. Nothing in storage is made public.
- No new background job; nothing session-less.

### Later: the online booking page (out of scope, designed for)

- `carAvailability`, `findCarResults` and the price function are pure and in
  packages/core; the data function takes the Operator id as an argument and
  returns nothing about Renters.
- The card, filter panel, sheet and preview go in packages/ui (and the
  component catalogue, rule 29) with the rego and the not-free section as
  options, so a public page can hide them.
- Showroom photos are their own kind, so a public page can serve only them,
  through the app (checking the car is listed and the photo not removed),
  never by opening the bucket. A public page will need its own way into the
  database (no session): its own plan, with rule 3 (Operator from trusted
  data, its booking-page address) and a read-only path that sees only listed
  cars.

### Tests

- **Core** (Vitest): `carAvailability` for: free; a booking overlapping at
  either end; touching ends (`[)` ranges: a booking ending at 10:00 and one
  starting at 10:00 don't clash); ongoing request with a later booking ("free
  until … only"); ongoing hold ("on an ongoing rental"); released hold
  ignored; draft (no hold) ignored; still out past its end; workshop before
  and after the start; next free across two back-to-back bookings; a span
  across a daylight-saving change (Sydney, Perth no DST). `weeklyPriceCents`
  (weekly, 7 × daily, none). `findCarResults`: each filter, "not set" hiding
  and the hidden count, facet counts, each sort with ties and nulls last,
  keyword with spaces, capitals and wildcard characters.
- **Database**: the new purpose checks (a Showroom photo can't name a
  checklist or damage record; a small copy must match its photo's kind; a
  Showroom photo needs a position); on a database filled at the previous
  migration (as `business-renters-update.test.ts` does), then inserting a car
  and a photo the way the deployed code does.
- **Tenant isolation**: Operator A's search never lists B's cars or counts
  B's holds; A can't open B's car in the preview or B's Showroom photo; A
  can't reorder B's photos.
- **Concurrency**: two confirms of the 100th and 101st Showroom photo at once
  (one refused); two reorders at once end with positions 1..n.
- **Performance**: 500 cars, 5,000 holds: the search stays under a set time
  in the test database (the number recorded in the commit).
- **Browser** (Playwright, `apps/web/e2e/find-a-car.e2e.ts`): step 1 to
  results to preview to form, keyboard only, at 375 px and computer width;
  the Filters sheet; a booked car only in the not-free section; "New rental
  for this car" warns at once on clashing dates; the race (car booked in
  another tab between preview and save) gives the clash message; Showroom
  tab add, star, move, remove, restore; axe on every screen; budgets.

### Legal (to docs/legal-notes.md as each slice lands)

- **Privacy (APPs 3, 6, 11)**: Showroom photos are meant to be seen; the tab
  says to keep people, other cars' plates and homes out. The redraw on the
  device removes location data, as for every photo. They are not personal
  information when they show only the car.
- **Consumer law, for the public page later**: photos and details must be of
  the actual car and current (misleading or deceptive conduct, s18; false
  representations about goods, s29 of the Australian Consumer Law); the price
  shown to a Renter must be the total they must pay, including any compulsory
  fees (component pricing, s48). Noted now so the public page plans for it.
- **Rideshare-ready** (decision 9): the tick is the Operator's own claim; if it
  is ever shown to Renters it is a representation the Operator must be able
  to stand behind. Platform and state rules differ and change (sources
  below), which is why the app doesn't decide it.
- No Spam Act, overseas disclosure or record-keeping change (photos stay in
  S3 Sydney, already listed).

Sources checked 8 Nov 2026 (through search; Uber's pages say to check the
state regulator for current rules):
[Uber, Melbourne vehicle requirements](https://www.uber.com/en-AU/drive/melbourne/vehicle-requirements/),
[Uber, Victoria state regulations](https://www.uber.com/en-AU/drive/resources/state-regulations-vic),
[Uber, Sydney vehicle requirements](https://www.uber.com/en-AU/drive/sydney/vehicle-requirements/),
[Uber, VIC hire car licence](https://www.uber.com/en-AU/drive/resources/vic-hire-car-license/).

### Slices (each small, reviewed, on the dev site before the next)

1. **Showroom photos.** Migration (purposes, position, checks, trigger,
   index, grants), core rules, 800 px card copy, Showroom tab. Mockup first.
   Quick review plus tenancy and evidence-separation tests (it touches
   storage rules).
2. **Car details for Find a car.** The Overview "for Find a car, add" line,
   the car form note, and the rideshare tick (decision 9) with its migration.
   Quick review.
3. **Availability, no new screen.** `carAvailability`, price, results
   functions with their tests; the data function; the booking form and
   `findBookingClash` callers also refuse a car still out past its end
   (decision 5). Deep review (booking correctness), two checkers.
4. **Find a car screens.** Step 1, results, filters and sheet, booked
   section, preview, hand-over to the form, the live clash warning for "New
   rental for this car", every "New rental" link updated. Mockups first.
   Quick review (screens) plus the browser tests.

### Order with the condition photos plan

Either can go first. If Showroom (slice 1) lands first, the car page briefly
has Showroom and the old Photos tab (still mixed) side by side; the rename to
"Condition photos" and the albums come with that plan's slice 3. The two
migrations touch different columns of `files` and can be applied in either
order.

### Test sheet rows (numbered when built, from the next free O- number)

New: Showroom tab (add any number, name and rename, star main, move,
remove, restore, cap message only at 100, people hint); car Overview "for Find a car" line; rideshare tick on the car form and
its filter (if approved); Find a car step 1 (dates, Ongoing, body type,
budget, "I know which car"); results list (cards, photo flip, details line,
price incl. short hire); each filter and its counts; Filters sheet on a
phone; sort; "hidden: not filled in" line; Booked for these dates section;
still-out and workshop cars; preview and Choose this car; form filled in from
Find a car; "New rental for this car" clash warning; booking race message.
Changed (Result back to "Not tested"): New rental (O-477 area), car page tabs,
Calendar free spot, "New rental for Sam" on a Renter's page. No admin rows.

### Out of scope

- The public online booking page and Renters choosing cars themselves.
- Holding a car while the form is filled in (a draft holds nothing, as today).
- Stock photos, captions on Showroom photos, video.
- Suggesting a price or a similar car when none is free.

### Self-review (senior engineer pass) and fixes made

- **Search shows "free" but the car is booked a second later**: the list is
  advice; the hold is written under the exclusion rule, whose refusal is
  turned into the existing clash message. The preview re-checks before
  offering Choose. No double booking is possible whatever the screens say.
- **Overdue car looked free**: found that holds end at the planned end while
  the car is still out. Fixed by counting open possessions (decision 5), in
  Find a car and in the form's check.
- **Ongoing requests**: a later booking makes the car "free until … only",
  not free; an ongoing hold has no next-free date. Both tested.
- **Workshop is not a hold**: the exclusion rule doesn't cover it, so it is
  advice only (decision 4), said plainly.
- **Not-set details**: no filter silently drops a car; the hidden count says
  so (decision 3). Nothing is made required on a filled database.
- **No price**: shown "No price set", sorted last, hidden by a budget filter
  with the count. The form still requires prices as today.
- **Evidence leaking into the Showroom**: separate file kinds, checks that a
  checklist or damage photo can only be `vehicle_photo`, a trigger that
  small copies match their photo's kind, and decision 7 (existing photos stay
  private).
- **Main photo vs order**: one source of truth (position 1).
- **101 photos by two phones**: counted under the car lock at confirm.
- **No visible limit**: the quiet cap of 100 keeps the preview page and
  storage bounded; storage is tracked per Operator (rule 23).
- **Tenancy**: every query scoped and in `withTenant`; address values only
  narrow the Operator's own cars; nothing about Renters in results that a
  public page could reuse.
- **Migration on a filled database with old code running**: new enum values
  and nullable columns only; old code never writes the new kinds; the
  widened checks accept every existing row (tested on a database filled at
  the previous migration).
- **Phone data use**: lazy first photo only, 800 px copies, 24 per page.
- **Price agreement**: short hire vs long-term decided by the same core
  functions the rent run uses.
