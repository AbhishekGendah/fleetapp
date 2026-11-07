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
