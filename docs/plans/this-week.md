# This week, fleet at a glance, and a calmer calendar

Agreed with Abhi on 2 Nov 2026, before Phase 3 slice 6 (the return). His
clients run large fleets (one has about 100 cars) of cheap cars on weekly
and ongoing rentals. A month calendar of bars is the wrong tool for that:
every ongoing rental is a bar across every day. What they need is what to
do this week, where every car is now, and which cars are earning nothing.

No schema change: everything here reads records that already exist,
scoped to the signed-in Operator (rule 1) as every other screen.

## 1. Dashboard: needs attention, then this week (docs/design/09)

Most urgent first, each line a count that opens what is behind it.
Nothing to do: the section says so in one line.

Needs attention:
- **Overdue returns:** active rentals whose planned end has passed.
- **Late pickups:** booked rentals whose start has passed, not handed over.
- **Not ready for handover** (booked, starting in the next 7 days): contract
  not signed, bond owing, Renter details or licence missing, car in the
  workshop. Each says which.
- **Renter details waiting for review.**
- **Rego and insurance:** expired, then due soon, for cars still in the
  fleet (not sold, written off or archived). Uses the existing warning days.
- **Licences:** expired or due soon, for Renters with a booked or active
  rental only (an old Renter's licence is not today's problem).
- **Back from the workshop late:** in service or off road with the
  expected-back date passed.

Today and this week (Operator's timezone, rule 10):
- Pickups today, returns due today.
- Starting in the next 7 days, ending in the next 7 days.

Fleet:
- Counts by status (Out, Available, In service, Off road), each opening the
  cars list filtered to it.
- **Idle cars:** available with nothing booked ahead, longest idle first,
  "idle since" = when its last rental ended (from possession), or when it
  was added if never rented. The five longest, then "See all".

Quick actions: New rental, Add a car, Add a Renter.

Later sections (money, fines, utilisation) come with their records.

## 2. Cars list: who has it, how long idle

- Status counts above the list as tappable chips (the existing status
  filter), so 100 cars narrow to the 9 available in one tap.
- A "Now" column: "Aisha Rahman, since 30 Oct" for a car that is out;
  "Idle 12 days" for an available one; nothing otherwise. Sortable by idle.

## 3. Calendar: changes, not bars

- Each rental shows as its two moments: the pickup and the return, one
  day each. An ongoing rental shows only its pickup. A month of 100 cars on
  long rentals then shows the handful of days something changes.
- One car chosen: whole rentals as bars, as now (one row, easy to read).

## 4. Later: fleet timeline

One row per car, bars across the weeks. FullCalendar's version is paid
and not on rule 32's licences. Built 3 Nov 2026 (Abhi asked for it then)
on DayPilot Lite 6.1.0 (Apache-2.0, released 9 Oct 2026): Rentals →
Timeline, four weeks from this week, read only, each bar a plain link so
it is reached from the keyboard.

## Tests

- Core (Vitest): the date rules (overdue, today, next 7 days, idle days)
  in the Operator's timezone, including around midnight and a daylight
  saving change.
- Database: each attention list, and that Operator A never sees Operator
  B's rentals, cars or Renters on it.
- Browser: dashboard and cars list at phone width, keyboard, axe,
  download budgets.

## Self-review

- Tenancy: every query takes the session's operatorId and runs in
  withTenant; no cross-Operator function is added.
- Money: only bond owing is shown, from the existing bond movements; no
  sums stored (rule 11).
- Privacy: the dashboard shows names and regos already on the lists; no
  licence numbers, no scans (rule 8).
- Scale: queries are one per section with database limits (counts, top 5),
  not one per car; the readiness check runs only for bookings in the next
  7 days.
