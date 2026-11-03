# Fleet timeline v2

Status: built 3 Nov 2026. Asked for by Abhi on 3 Nov 2026 after using v1 on his phone
("happy with all of your suggestions"). No schema, money, auth or tenancy
change: reads only, every query scoped by the session's Operator.

## What changes

1. **Past and future, scrolled freely.** The page loads a long stretch
   (13 weeks before the week asked for, 26 weeks after it; the week
   asked for defaults to this week) and opens scrolled to today. Scrolling
   and swiping through it is smooth; nothing reloads.
   - Today onwards comes from the live car holds (bookings and rentals
     out), as in v1.
   - The past comes from possession records that have ended (who really
     had the car, rule 15): a returned rental, or a car handed back in a
     swap. Holds are released at a return, so v1 could not show these.
   - A rental out now shows once: its live hold. Its open possession is
     not drawn again.
   - **Today** scrolls back to today. **Go to a date** (a date box) loads
     the stretch around that date and scrolls to it, for anything further
     out.
2. **Zoom: Days, Weeks, Months.** A toggle above the timeline. Days shows
   about two weeks across a computer screen, Weeks about two months,
   Months about half a year (one cell per week). The choice stays in the
   page address.
3. **Fills the screen.** The day width is worked out from the box's
   width (re-measured when the window is resized or the phone turned), so
   a big screen shows more, never less. It never goes under a width that
   stays readable and tappable; below that the timeline swipes sideways
   inside its box.
4. **Choose which cars.** Above the timeline: a search box (rego, make,
   model, colour), a status toggle (All, Available, Out, Workshop, where
   Workshop is In service or Off road) and a "Cars" picker to choose one
   or several cars. Filtering happens in the browser at once, and the
   choices stay in the page address (nuqs), so a refresh or a shared link
   keeps them. "Clear" resets them.
5. **Car name opens a quick view.** Each car's name in the left column is
   a button. It opens a panel: from the right on a computer, from the
   bottom on a phone (Base UI Drawer; swipe it away or press Escape). It
   shows rego and state, make, model, year, colour, status (with the
   workshop reason and expected back date), kilometres, rego and
   insurance expiry, who has the car and since when, and the next booking.
   Buttons: Open car page, New rental for this car.
6. **Tap an empty day** on a car's row: opens New rental with that car and
   that day as the start (9:00 am, changeable). The keyboard way is the
   panel's New rental button.
7. **Workshop and off-road time** shows as a grey striped block on the
   car's row from today to its expected back date, labelled with the
   reason. Not a link (the car's name opens the car).
8. **Today** is shaded on every row, and a legend says what each colour
   means: Booked, Out, Finished, Workshop.

Not included on purpose: dragging bars to move or resize bookings.
Changing an active rental's dates is a logged change with notice rules
(rule 14) and, from Phase 4, charges; it stays on the rental page where
every check runs.

## How it is built

- **packages/ui (new pieces first, rule 29, all on Base UI, no new
  dependency):**
  - `Drawer`: a side panel on a computer, a bottom sheet on a phone (Base
    UI Drawer). Title, close button, focus kept inside while open.
  - `ToggleGroup`: a row of pressed or not buttons choosing one value (Base
    UI ToggleGroup), 44px tall (rule 24).
  - `MultiRecordPicker`: the record picker choosing several (Base UI
    Combobox with `multiple`), chosen ones shown as removable chips.
  - `FleetTimeline` grows: zoom level, measured cell width, scroll to a
    date, row header as a button (`onRowClick` given the row id), empty-day
    selection (`onDayChosen`), shaded today, non-link blocks, a legend.
  - All four go into the component catalogue.
- **packages/core:** `timelineWindow(asked, now, timeZone)` (the loaded
  stretch), the zoom levels and their sizes, the status groups for the
  filter, and `cellWidthFor(boxWidth, zoom)`. Tests for each, including
  the Operator's clock around midnight.
- **apps/web:**
  - `listTimelinePossessions(db, operatorId, window)`: ended possessions
    overlapping the window, with the Renter's name and the rental id.
    Tenant isolation test: another Operator sees none.
  - The page loads every current car (VehicleSummary, which now also
    carries the status reason and expected back date), the live holds and
    the ended possessions for the stretch, and hands them to the client
    view, which filters, zooms and opens the panel.
  - New rental takes a `startsOn` preset (a calendar date, checked) as
    well as the car.

## As built (differences from the above)

- On a phone, the status buttons, the car picker and Go to a date sit
  under a "More choices" fold (the browser's own details element: it
  opens from the keyboard and is read out, with nothing to download), so
  the timeline is in view first. Open on a computer.
- A tap on an empty day uses DayPilot's time-range selection (its
  time-range click is not raised in the Lite edition); proven with a
  touch screen in the browser tests.
- DayPilot draws every bar and row, not only those scrolled into view, so
  the keyboard and screen readers reach them all.

## Checks

- Browser (phone and computer width): scroll back to last month and see a
  returned rental; zoom to Months; filter by search, status and chosen
  cars, then refresh and the filter stays; open the panel from the car's
  name with the keyboard and with a tap, Escape closes it, Open car page
  and New rental work; tap an empty day and New rental opens with the car
  and day filled. axe on each state, no sideways page scroll, download
  budget (re-measured, raised on purpose with the reason).
- Legal: no new data. Past rentals show the Renter's name, as the Rentals
  list already does.
