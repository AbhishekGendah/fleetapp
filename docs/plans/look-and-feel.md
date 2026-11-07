# Look and feel: theme and everyday improvements

Status: draft for Abhi's approval (6 Nov 2026). Screens only: no schema,
money, auth or tenancy changes. Direction chosen by Abhi on 6 Nov:
**A (Calm and clear), with B's navy summary strip on a rental's page**
(the canvas: claude.ai artifact "Fleet app look: 3 directions").

## Part 1: the theme (direction A)

Everything is drawn from the shared pieces in packages/ui (rule 29), so most
of this is a change to those pieces and every screen follows.

- **Colours stay the logo's**: navy for text and main buttons, teal for
  links and the current tab, cyan for decoration only. Page background a
  touch cooler (#F5F7F9); cards white.
- **Cards**: rounder (16 px corners), a soft shadow instead of a grey
  outline, more padding. Section labels small and in capitals
  ("NEEDS ATTENTION"), the card's main fact large.
- **Status labels**: one shared "chip" piece (Due soon, Missing, Out,
  Available, Workshop, Paid…), each colour also differing in lightness so
  colour-blind people can tell them apart (rule 24, WCAG).
- **Big numbers** where they matter: what's owing, cars out/available/in
  the workshop.
- **Buttons**: main action navy, full-width on phones, at least 48 px tall;
  secondary actions soft grey-teal.
- **Rental page**: B's navy strip at the top with the rego, status, what's
  owing and the next rent, then the cards.
- **Tab bar**: icons with labels; the current tab in navy.
- Emails and PDFs keep their own simple style (email apps ignore most
  styling); only their colours follow the brand file.

How it's checked: every screen's browser tests and accessibility checks
(axe, WCAG 2.2 AA) at phone and desktop width, the download budgets, and a
screenshot of each main screen before and after for Abhi to compare.

## Part 2: everyday improvements (tick the ones you want)

My recommendation first in each; the tradeoff in one line.

1. **The logo is the Home link** (Abhi's idea), in the header and the
   sidebar, as on the admin site. Recommendation: do it everywhere, and on
   phones **keep** the Home tab in the bottom bar too. Tradeoff: one
   duplicate way home; in return phone users keep the thumb-reach tab every
   phone app has (the logo is at the top, hard to reach one-handed).
   Alternative: drop the Home tab on phones too, leaving four tabs.
2. **Account menu instead of a Sign out button**: a round initial in the
   header opens Business details, Settings and Sign out. Tradeoff: sign out
   is one more tap; in return the header is cleaner and can't be
   tapped by accident.
3. **Search from anywhere**: one search box in the header that finds a car
   by rego, a Renter by name or phone, or a rental, and opens it. Tradeoff:
   a small amount of new code; in return the most common job (find this car
   or this person) is one step from every page.
4. **The next step as the main button** on a rental: Send contract, Start
   handover, Start return or Close, whichever is next, always at the top
   under the navy strip. Tradeoff: none worth noting.
5. **Tap to call, text, email or map**: Renters' phones, emails and
   addresses become links that open the phone's own app. Tradeoff: none.
6. **Friendlier dates**: "Today 10:00", "Tomorrow", "Thu 13 Nov" instead
   of full dates where it's clear. Full date on hover/long-press. Tradeoff:
   none; documents (PDFs, invoices) keep full dates.
7. **Empty pages say what to do next**: e.g. "No rentals yet. Add a car,
   then a Renter, then a rental" with the buttons. Tradeoff: none.
8. **Same "Saved" message everywhere**: a short confirmation that appears
   and fades, in one shared piece, instead of each form's own line.
   Tradeoff: messages that need reading (warnings) stay on the page.
9. **Admin Suspend asks with the shared "Are you sure?"** instead of the
   browser's plain pop-up (flagged 5 Nov, rule 29). Tradeoff: none.

Abhi's own: add any more here, or mark them in the test sheet's notes as
you test (an "Issue" or a note on a row is enough).

## How it's built

- Slice 1: the theme in packages/ui and the app frame (header, sidebar,
  tab bar, logo as Home, account menu); the component catalogue updated.
- Slice 2: the dashboard and the rental page (navy strip, next-step
  button, chips, big numbers).
- Slice 3: the improvements Abhi ticks (search, tap to call, dates, empty
  pages, saved messages, admin Suspend).
- Each slice: browser tests updated, accessibility at phone and desktop
  width, budgets, test sheet rows, and before/after screenshots for Abhi.

## Not in this plan

- New features (weekly debits etc.: Phase 4 plans).
- A dark mode (possible later; not asked for).
- Renaming the product (one file, packages/ui/src/brand.ts, when needed).

## Slice 2: dashboard decisions so far (Abhi, 6 Nov 2026)

Agreed on the mockup (claude.ai artifact "Operator dashboard"). Not built
until Abhi says go.

- **Top bar (computer)**: business name on the left; a short search box
  in the middle with a magnifying glass, a soft fill and a thin outline
  (WCAG 1.4.11); the account button is just the round initial, no name or
  arrow. Search shows results as you type, grouped Cars / Renters /
  Rentals, keyboard-usable, on the shared drop-down library.
- **Side menu (computer)** stays put when the page scrolls (today it
  scrolls away; only the top bar is fixed).
- **Rows**: title is always the who or what (a rego or a Renter's name).
  The second line says what's wrong, and the label says how urgent.
  - On a computer, the whole row opens the main thing (the rental, or
    the place to fix it). Names and regos inside it are their own links
    (bold teal, navy on hover, never underlined: Abhi, 7 Nov) to the Renter or the car. The row's
    link is stretched over the row, so there are no links inside links.
  - On phones, one tap per row (44 px targets).
- **Handover / return rows** open the rental page (its main button is the
  next step), not the checklist directly. "Later this week" dates open the
  rentals calendar on that day.
- **No "Owed to you" card.** Late payers go in Needs attention instead.
- **Needs attention rule**: something the Operator must do, that the app
  can't, which disappears once done. Items:
  - Overdue: a failed direct debit at once; hand payments 2 days after
    the due date (grace days a setting, default 2).
  - Rego or insurance missing or due.
  - Licence due, for Renters with a car now.
  - Renter details to review.
  - Not ready for handover.
  - Bond to refund.
  - Damage open.
  - Late back from the workshop.
- **Needs attention shows the 5 most urgent** with "See all N" to a full
  page (shared list: pages, search, filter by kind). The count bubble
  shows the real total. Urgency order:
  - red: overdue, missing, handover today not ready;
  - amber: due soon, damage open, late from the workshop;
  - blue: to review, to refund;
  - within each, the longest waiting first.
- **Moved out of Needs attention**: idle cars (shown with the car counts
  as "available"); claims under way (they belong on the Damage page).
- **Wording**: details to review reads "Sent their licence and contact
  details to approve".

### The navy strip rule (agreed 6 Nov)

Every single-item page (one rental, one car, one Renter) opens with the
navy strip: its name, status and key facts. Lists and the dashboard stay
white. It is one shared piece in packages/ui. Cars and Renters get it in
their own later slice.

### One rental's page (agreed 6 Nov)

- Navy strip at the top:
  - rego · Renter (each a link), the car, a status label;
  - the key facts: before handover, the handover time, rent and bond;
    once out, owing, next rent, bond and km at handover;
  - its buttons on a computer: Start return, plus Add charge and
    Swap car.
- A "Next step" card while booked: ticks for contract signed, bond paid
  and details approved, then the main button (Start handover, or
  whatever is missing).
- Tabs instead of one long page:
  - **Overview**: details, change buttons, latest money, damage,
    signed papers;
  - **Money**: charged / paid / owing; lines with their GST; how they
    pay; bond; invoices and receipts;
  - **Papers**: contract, handover and return reports, changes, each
    with Open PDF and Email again;
  - **Log**: everything that happened, with a "By" filter
    (You / Renter / Automatic).

### Rentals list (agreed 6 Nov)

- A table on a computer and cards on phones.
- Columns: Renter, Car, When, Rent, Owing (red when behind), Status.
  Names and regos are links as on the dashboard; the rest of the row
  opens the rental.
- Status filters with counts, in plain words:
  - Out (was Active);
  - Booked;
  - To close (was Returned);
  - Finished (Closed and Cancelled; a cancelled one still says so).
- "When" is one column: "Back today 3:30 pm", "Starts Fri 7 Nov".
- **Calendar is its own page**: a side-menu item on a computer, under
  More on phones, and a Calendar button on Rentals. The timeline (cars
  down the side) becomes the Calendar page's second view.

### Calendar page (agreed 6 Nov)

- **Computer: Month view.**
  - Monday-first grid; today circled.
  - Labels per day: handover (teal), return (amber), and reminders and
    rent runs (grey). Each opens its rental, car or list.
  - A day's number opens that day.
- **Computer: By car view** (was Timeline):
  - cars down the side, two weeks across, today's column shaded;
  - bars for out (navy), booked (light blue) and workshop (amber), plus
    a key;
  - a bar opens the rental and a rego opens the car;
  - clicking a free spot starts New rental with that car and date.
- **Top of the page**: previous / next, Today, a searchable car filter
  (every car, "rego · make model"), and New rental.
- **Phone**: Day by day (this week's strip with dots, then a card per
  day) or By car (scrolls sideways). Calendar sits under More.

## As built: slice 1 (6 Nov 2026)

- Theme tokens (packages/ui/src/styles/theme.css and brand.ts): page
  #F5F7F9, a soft card shadow, a soft red for danger labels.
- Shared pieces: cards (16 px corners, shadow, transparent edge kept for
  high-contrast mode), navy bold card titles, status labels (Badge) bolder
  with clearer colours, buttons and boxes rounder, the current tab and count
  filled navy.
- App frames: top bar stays put, logo goes Home (both apps); the Operator
  app keeps its Home tab on phones (approved).
- Next: slice 2 (the Operator dashboard and rental page with the navy strip)
  and slice 3 (the nine improvements), once Abhi says go.


## As built: slice 2, the dashboard (6 Nov 2026)

- Greeting with the day above it; New rental, Add car and Add Renter in
  one row (a new soft button style for the quieter two).
- Finish setting up: how many steps are done, a progress bar and the one
  step to do next.
- Needs attention: one list, the five most urgent, the real total in the
  red bubble, and "See all N" opening the full list (/attention: pages of
  25, search, a filter by kind). Labels and colours:
  - red: Overdue (late back from a rental), Missing or Expired (rego or
    insurance), Late (pickup missed), Not ready (handover today);
  - amber: Due soon (rego or insurance), Open (damage), Late (back from
    the workshop), Licence due, Not ready (handover later this week);
  - blue: To review (Renter details), To refund (bond).
  - Within a colour, the longest waiting first.
- Claims under way left the dashboard: each claim is followed on its
  damage record (a car's Damage tab). There is no fleet-wide damage page
  yet.
- Today: handovers and returns by time, then Later this week. A later
  day's date opens the calendar on its month for now; it opens on the day
  itself once the calendar is redesigned.
- Your cars: Out, Available and Workshop counts, each opening the cars
  list filtered (a new "In the workshop" filter: in service or off road).

## As built: one rental's page (6 Nov 2026)

- Navy strip: rego · Renter, each a link (to the car, to the Renter); the
  car with "weekly" or "daily" and its end ("no end date" when ongoing);
  the status in plain words: Draft, "Booked · handover today" (or its
  day), "Out since Fri 6 Nov", "To close" (was Returned), Closed,
  Cancelled, plus Overdue and At risk when they apply.
- Facts before handover: Handover (day and time), Rent ($ and "a week" or
  "a day"), Bond (Not paid yet, $X still to pay, On its way, Paid). Once
  out: Owing (from the ledger; "All paid up" at $0.00, "Since <day>" when
  behind, or in credit), Bond (Held, Refunded, Kept), At handover (km and
  fuel of the car the Renter has now).
- Next rent: added 7 Nov 2026 from the rent run's own rule (see
  docs/plans/look-slice-2-overdue.md, As built).
- The strip's button: Start return (or Continue return) once out, unless a
  car swap is under way. Add charge and Swap car stay in their cards (both
  are forms in a pop-up), so they are not repeated on the strip.
- Next step (draft or booked): ticks for contract signed, bond paid and the
  Renter's details approved (no problem about the Renter: details missing,
  licence, age, provisional, Do not rent). The main button: Book this car
  (a draft); Continue handover; Start handover once the contract is signed
  and nothing is in the way; otherwise the first missing thing (Send
  contract opens Papers, Take the bond opens Money, Check <name>'s details
  opens the Renter), with Start handover still offered beside it so a
  reason can be given at the handover. The problems the booking checks
  find are listed under it, as before.
- Tabs: Overview (details, changes, the return under way, swap, rates,
  damage, cancel; on a computer also Latest money and Signed papers), Money
  (charges and payments, How <name> pays, bond, invoices and receipts),
  Papers (the contract to send, then every signed paper with Open and
  Email again, and the reports still to come), Log. An old `?tab=summary`
  address opens Overview.
- The Money tab's Charged, Paid and Owing totals: added 7 Nov 2026 (see
  docs/plans/look-slice-2-overdue.md, As built).
- Not yet: the Log's "By" filter (the Log list has no filters yet).

## As built: the Rentals list and the Calendar (6 Nov 2026)

- **Rentals list**:
  - Header: Calendar (outline, with its icon) and New rental. The Timeline
    button is gone: the timeline is the Calendar's By car view.
  - Status filters as counts, in plain words: All, Out, Booked, Draft (only
    while there are drafts, so they stay findable; a draft holds no car, so
    it is not counted as Booked), To close, Finished (closed and cancelled;
    a cancelled one still says Cancelled). Old addresses (?status=active,
    returned, closed, cancelled) open the filter that holds them now. The
    shared list's Status box is still there too, as on Cars.
  - Columns: Renter and Car (rego) as their own links, When (the row's link
    to the rental), Rent ("$350.00/wk" or "/day"), Owing, Status (Out navy,
    Booked blue, To close amber, Draft, Closed and Cancelled grey; Overdue,
    At risk and Starting soon as before).
  - When: "Starts Sat 7 Nov, 9:00 am" (or "today"), "Since Fri 6 Nov,
    ongoing", "Back today 3:30 pm", "Fri 9 Oct to Tue 10 Nov" (a phone says
    "Back Tue 10 Nov"), "Was due back Tue 3 Nov", "Returned Tue 3 Nov", a
    finished one's span.
  - Owing: added up from each rental's ledger lines (one query for the page,
    the same rule as everywhere), red and bold when owed; "–" while nothing
    has been charged or paid on it. On a phone: "$450.00 owing", "Paid up",
    "$20.00 in credit", or the rent while nothing is charged. No overdue or
    grace rules here (their own plan).
  - Order: most relevant first: out (soonest back first, ongoing after),
    then bookings and drafts (soonest first), then to close (longest
    waiting first), then finished (latest first). A column heading still
    sorts by that column.
  - Phone: a card per rental (name and status, "rego · make model", When
    and the money), one tap opening the rental.
- **Calendar** (one page; Month or By car, in the address as ?view=car):
  - Top: Calendar and New rental; previous and next (a month, a week on a
    phone, two weeks By car), the stretch's name, Today, a searchable car
    filter ("All cars" or one, by rego, make or model), and the view switch.
  - Month (computer): Monday first, today circled navy, handovers teal and
    returns amber ("9:00 am Handover · Jamie · 1ABC234"), each opening its
    rental; long labels wrap rather than being cut short. A day's number
    opens that day (?day=2026-11-07): it is ringed, and its handovers and
    returns are listed above the grid. The dashboard's Later this week dates
    now open their day.
  - Day by day (phone, the usual view there): previous and next week, the
    week's seven days with a dot where something is on (today filled navy),
    then a card per day with something on (and the day asked for), each row
    opening the rental.
  - By car (was the Timeline): cars down the side (rego opening the car,
    make and model under it), out navy, booked light blue, workshop amber,
    finished grey, a key, today's column shaded; a bar opens its rental and
    a free day starts New rental with that car and day (kept from the
    timeline). Zoom (Days, Weeks, Months) and Show cars stay. On a phone it
    swipes sideways inside its box. The old /rentals/timeline address opens
    it (on its day and zoom).
  - Not yet: grey reminders and rent runs on the month (the calendar has no
    such data yet: rego due dates and the rent run would be new sources),
    and the timeline's search box, "Only these cars" and "Go to a date"
    (the car filter, previous/next and Today replace them), and the car's
    pop-up quick view (the rego now opens the car's page).

## As built: header search (6 Nov 2026)

- **Computer**: a box of about 340 px in the middle of the top bar, as on
  the agreed mockup, with a magnifying glass, a soft grey fill and a thin outline; placeholder "Search cars,
  Renters, rentals".
- **As you type**: from 2 characters, 0.3 seconds after the last key. The
  drop-down shows up to 5 of each kind, grouped under small capitals: Cars
  (rego, then make and model), Renters (name, then phone), Rentals ("Name ·
  rego", then the status in the Rentals list's words). Names and regos are
  bold teal. Nothing found reads "No matches for “…”".
- **What matches**: each kind is searched as its own list searches it, in
  that list's order: cars by rego (spaces, dashes and capitals ignored),
  make, model, colour or VIN; Renters by name, phone (with or without
  spaces, or +61), email or licence number; rentals by the Renter's name or
  the rego, most relevant first. Archived cars and Renters are left out, as
  on their lists. Only the business's own records, ever.
- **Keyboard**: Tab reaches the box; arrows move through the results, Enter
  opens one, Escape closes the list. Read out as a combobox with a list of
  grouped options.
- **Phone**: a round search button (44 px) beside the account button opens
  the same search across the top of the screen, box focused, with Close.
  Escape, Close or the phone's Back closes it. A result opened from it takes
  the search's place in the history, so one Back returns to where you were.
- **Download size**: the search's code loads only when the box is focused
  or the button pressed, so no page's budget was raised.
- **Different from the mockup**: the results list sits under the box in the
  page rather than in a pop-up layer, because Base UI's pop-up hides the
  rest of the page from screen readers while open, which the accessibility
  check flags. It looks the same.

## Cars and Renters pages (mockups, 7 Nov 2026)

Mockups on the design canvas (Cars list, one car, Renters list, one Renter;
phone and computer). Abhi's decisions so far:

- Car status word **Out** (not "Rented"), matching Home and Rentals.
- **No licence number** shown on a Renter's page or lists; licence shows as
  class, state and expiry only. Licence photos never show, only "on file".
- New Renter filters approved: Renting now, Booked, To review (plus All, Do
  not rent, Archived).
- One car's page keeps all **9 tabs** (Overview, Rentals, Rego & insurance,
  Damage, Costs, Photos, Documents, Odometer, Log).
- Lists show the phone number only, never the email.
- Abhi looked through every tab of both pages and approved the mockups as drawn (7 Nov 2026).

## As built: the Cars list and one car's page (7 Nov 2026)

- **Status labels**: Out (was Rented, everywhere: the car's status word now
  reads as on Home and Rentals) light cyan; Available outlined on white (a new
  `available` Badge tone, the lightest); In service and Off road amber; Sold,
  Written off and Archived grey. In the component catalogue.
- **Cars list**:
  - Header: Insurance (outline, with its shield) and Add car.
  - Filters as counts: All, Out, Available, In the workshop (in service and
    off road), Archived; Sold and Written off only while there are any, so
    they stay findable. Old addresses (?status=rented, in_service, off_road,
    written_off) open the filter that holds them now. The shared list's
    Status box is still there too.
  - Columns: Car (the rego, bold teal, is the row's own link: the rest of the
    row opens the car too; make, model, year and colour under it), Status,
    Now, Rego (date with Due soon or Expired, Direct debit, or Missing in
    red), Insurance (the same), Odometer. The exports keep State, Make and
    model, Year and Colour as their own columns (a list column can now be
    for the exports only).
  - Now: "Jamie Park, since Fri 6 Nov", "Alex Ng, back today 3:30 pm", "Jamie
    Park, was due back Tue 3 Nov" (the name opens the Renter); "Panel repair,
    back Mon 9 Nov" (or "was due back"); "Idle 4 days"; "Booked by Riley Chen,
    Sat 7 Nov" when a booking starts today or tomorrow, else "Idle 12 days ·
    booked by Taylor Smith, Tue 17 Nov". Who has a car comes from their open
    possession (rule 15), so a car swapped away mid-rental still shows with
    the Renter until it is back.
  - Phone: a card per car (rego and status, make and model, then what it is
    doing and either a paperwork line, "Rego due Thu 12 Nov", "No
    insurance", or the odometer), one tap opening the car.
- **One car's page**:
  - Navy strip: the rego and its state, "2022 Toyota Corolla Ascent Sport ·
    white · hatch, automatic", the status and what it is doing ("with Jamie
    Park, since Fri 6 Nov", the name a link). Facts: Odometer (km, "At
    handover Fri 6 Nov" / "Typed in Mon 2 Nov"), Rego ("Thu 12 Nov", "Due in
    6 days · VIC"; Direct debit; Missing), Insurance (its end and the
    insurer), Price ("$350.00/wk", "$60.00 a day"). Buttons: Edit, Record
    damage (its form in a pop-up) and New rental for this car.
  - Tabs, in the mockup's order: Overview (was Details; an old ?tab=details
    opens it), Rentals, Rego & insurance, Damage, Costs, Photos, Documents,
    Odometer, Log.
  - Overview: Now (the rental out with its Renter, its When and rate as the
    row's link to the rental; the next booking, or why there is none), Open
    damage (three, each opening its record; All damage ›), Details (Edit
    details); beside them on a computer, Rego and insurance (a line each
    with Current, Due soon, Expired, Missing or Direct debit; See all ›),
    Prices, Status (the status form, the transfer-not-lodged warning, and
    Archive or Restore).
  - Rentals: the Rentals list's table without the Car column (Renter, When as
    the row's link, Rent, Owing from the ledger, Status); cards on a phone.
    The latest 25, as before.
  - Damage: Open, Claims under way (lodged or approved) and Repaired or left,
    each row opening its record from anywhere on it.
  - Rego & insurance and Costs sit side by side on a computer; every card's
    name is in small capitals; an odometer reading says where it came from
    ("typed in", "at a handover").
- **Different from the mockup**:
  - Record damage is on the strip only (the mockup also had it in the Open
    damage card and the Damage tab), so the page has one Record damage
    button whichever tab is open.
  - "Idle 12 days · booked by Taylor Smith, Tue 17 Nov" says "booked by"
    (the mockup had just the name), so the line reads as a booking.
  - Rego and insurance dates in the list stay full dates ("12 Nov 2026"); the
    mockup wrote a due date as "Thu 12 Nov".
  - The Overview's Status card keeps today's status form (a choice of In
    service, Off road and Available, with a reason and an expected day)
    rather than a "Put in workshop" button.
- **Not yet** (the app has no data for them): "Pay by direct debit instead"
  and "Open policy ›" / "10 other cars ›" on the Rego & insurance tab as
  drawn (the tab keeps today's forms and the policy link); "4 rentals since
  April" under the Rentals table; the Log's "By" filter (the Log has no
  filters yet, as on a rental's page).

## As built: the Renters list and one Renter's page (7 Nov 2026)

- **Status labels**: Renting light cyan, Booked blue, Not renting grey, Do not
  rent solid dark red with white words (a new `refused` Badge tone, the
  darkest), Overdue red, Licence due amber (Licence expired red), To review
  and To refund blue, Archived grey. Not renting shows only when nothing else
  does.
- **Renters list**:
  - Filters as counts: All, Renting now, Booked (a car booked and none out),
    To review (was "Waiting for review"), Do not rent, Archived. Old
    addresses: ?status=waiting_review opens To review, do_not_rent opens Do
    not rent, active opens All.
  - Columns: Renter (the name, bold teal, is the row's own link; the phone
    under it, never the email), Status, Renting (the car's rego, which
    opens the car, over "Back today 3:30 pm", "Since Fri 2 Oct, ongoing" or
    "Starts Sat 7 Nov, 9:00 am"; else "Last back Tue 29 Sep" or "No rentals
    yet"), Owing ("$450.00" red and bold, "$20.00 in credit" teal, "$0.00",
    or "–" while nothing has been charged), Licence to (its expiry with Due
    soon or Expired, or "Not on file"; never the number), Since ("Mar
    2026"). Search reads "Search by name, phone or email" (a licence number
    still finds them).
  - Owing adds up the Renter's rentals' ledger lines by the one ledger rule
    (rule 11). Overdue works each rental out from its own lines with today's
    grace days, as Needs attention does (so credit on one rental never hides
    another's arrears). To refund is Needs attention's bonds to refund.
    Three queries for a page, scoped to the business.
  - The exports hold what the list shows: the email is no longer in them.
  - Phone: a card per Renter (name and labels, the car and when it is back,
    "Since Mar 2026" and "$180.00 owing" / "Paid up" / "$20.00 in credit"),
    one tap opening the Renter.
- **One Renter's page**:
  - Navy strip: the name; the phone and email, each opening the phone's own
    app (and "Goes by Sam" when they have a preferred name); their labels.
    Facts: Owing (from the ledger: "All paid up", "Since Wed 28 Oct", or
    "9 days late" when a rental is overdue), Renting now (the rego, a link to
    the car, "Hyundai i30 · back Tue 10 Nov"; Booked and its start; or
    "Last back …"), Licence ("Full · VIC", "Expires 14 Mar 2029"), With you
    since ("Jul 2026", "2 rentals": drafts and cancelled bookings not
    counted). Buttons: Edit and New rental for Sam.
  - Tabs, in the mockup's order: Overview (new, the page's plain address),
    Rentals, Money, Details (keeps ?tab=details), Licence, Notes, Log.
  - Overview: Still needed before renting and the same-phone-or-email note
    first when they apply; Money (what they owe, big, with Overdue · 9 days,
    then the three newest lines with their car; All money ›), Now (the car
    out, its When and rate the row's link; the next booking), Latest note
    (All notes ›); beside them on a computer, Contact (Call, Text, Email;
    All details ›), Licence (type, state and class, its expiry with
    Current, Due soon, Expired or Not on file, and whether both photos are
    on file; Licence ›) and the Details form (send, cancel, and Review what
    they sent when they have).
  - Rentals: the Rentals list's table without the Renter column; Money:
    Charged, Paid and Owing added up from the lines, then every line with
    its car; Details: details, status (Do not rent), everything we hold and
    archive, side by side on a computer; Licence: the licence (never its
    number) and its photos, each "Front: on file" with Open front, opening
    through the short-lived link and logged as before (rule 8).
- **Different from the mockup**:
  - The details form (Send, Send again, Cancel link, Review what they sent)
    is on the Overview only; the mockup also drew it on Details. One place
    to send it from.
  - Send a link is not on the strip: it is the Overview's details form.
  - The licence number is in the Edit licence form (opened on purpose, to
    change it), as it must be kept to nominate a driver for a fine. The
    Review what they sent page still shows the number the Renter typed, to
    check it against their photo.
  - Details missing (as a list label) is not built: whether details are
    missing needs the licence photos, which the list does not read; the
    Renter's own page still says what is needed before renting.
- **Download size**: the Cars and Renters lists keep their 190 KB budgets.
  New budgets for the single-item pages, on purpose: a car's page 500 KB
  (453 measured at phone width) and a Renter's page 445 KB (404 measured),
  about 10% over, as the rental page has; their weight is the shared form
  pieces (Record damage, status, the details form sender).
- **Not yet** (not money the app works out for a Renter yet, so left out
  rather than built): Money tab's How Sam pays, Bond and Invoices and
  receipts across all their rentals (each rental's page has them), and the
  strip's "bond $500.00 held"; the Money card's one-line explanation of what
  is overdue; "2 rentals since Jul 2026 · no fines yet" under Rentals (no
  fines yet); the Log's "By" filter.
