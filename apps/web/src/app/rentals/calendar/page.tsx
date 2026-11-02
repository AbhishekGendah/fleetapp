import { isRecordId, RENTAL_STATUS_LABELS, type RentalStatus } from "@fleetapp/core";
import { AutoSubmitSelect } from "@fleetapp/ui/auto-submit-select";
import type { BookingTone, CalendarEntry } from "@fleetapp/ui/bookings-calendar";
import { Card, CardContent } from "@fleetapp/ui/card";
import { Label } from "@fleetapp/ui/input";
import { PageHeader } from "@fleetapp/ui/page-header";

import { appDb } from "../../../lib/app-db";
import { rentalPath, RENTALS_CALENDAR_PATH, RENTALS_PATH } from "../../../lib/paths";
import { listPickableCars } from "../../../lib/rentals/pickable-records";
import { listCalendarBookings, type CalendarBooking } from "../../../lib/rentals/rental-queries";
import { requireUser } from "../../../lib/require-user";
import { AppShell } from "../../app-shell";
import { CalendarView } from "./calendar-view";
import { CAR_PARAM, chosenMonth, MONTH_PARAM, monthWindow } from "./calendar-window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL_CARS = "";
const TONES: Readonly<Record<RentalStatus, BookingTone>> = {
  draft: "draft",
  booked: "booked",
  active: "active",
  returned: "finished",
  closed: "finished",
  cancelled: "finished",
};

/**
 * All cars: only the moments something changes, a pickup and a return, so
 * a fleet on long rentals is not a wall of bars. An ongoing rental has only
 * its pickup.
 */
function toMoments(booking: CalendarBooking, window: { from: Date; to: Date }): CalendarEntry[] {
  const label = `${booking.rego} · ${booking.renterFullName}`;
  const moments = [
    { kind: "pickup", title: `Pickup: ${label}`, at: booking.heldFrom },
    { kind: "return", title: `Return: ${label}`, at: booking.heldUntil },
  ];
  return moments.flatMap((moment) =>
    moment.at && moment.at >= window.from && moment.at < window.to
      ? [
          {
            id: `${booking.rentalId}-${moment.kind}`,
            title: moment.title,
            start: moment.at.toISOString(),
            href: rentalPath(booking.rentalId),
            tone: TONES[booking.status],
          },
        ]
      : [],
  );
}

/** One car: its rentals in full, as bars. */
function toEntry(booking: CalendarBooking, windowEnd: Date): CalendarEntry {
  const isOngoing = booking.heldUntil === null;
  return {
    id: booking.rentalId,
    title: `${booking.rego} · ${booking.renterFullName}${isOngoing ? " (ongoing)" : ""}`,
    start: booking.heldFrom.toISOString(),
    // An ongoing rental runs on past whatever month is shown.
    end: (booking.heldUntil ?? windowEnd).toISOString(),
    href: rentalPath(booking.rentalId),
    tone: TONES[booking.status],
  };
}

export default async function RentalsCalendarPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const timeZone = user.operatorTimezone;
  const month = chosenMonth(searchParams[MONTH_PARAM], timeZone);
  const carParam = searchParams[CAR_PARAM];
  const vehicleId = typeof carParam === "string" && isRecordId(carParam) ? carParam : undefined;
  const window = monthWindow(month, timeZone);
  const [bookings, cars] = await Promise.all([
    listCalendarBookings(appDb, user.operatorId, { ...window, vehicleId }),
    listPickableCars(appDb, user.operatorId),
  ]);

  return (
    <AppShell user={user}>
      <PageHeader backHref={RENTALS_PATH} backLabel="Rentals" title="Calendar" />
      <form action={RENTALS_CALENDAR_PATH} className="flex flex-col gap-2 sm:max-w-xs">
        <Label htmlFor="calendar-car">Show</Label>
        <AutoSubmitSelect id="calendar-car" name={CAR_PARAM} defaultValue={vehicleId ?? ALL_CARS}>
          <option value={ALL_CARS}>All cars</option>
          {cars.map((car) => (
            <option key={car.value} value={car.value}>
              {car.label}
            </option>
          ))}
        </AutoSubmitSelect>
        <input type="hidden" name={MONTH_PARAM} value={month} />
      </form>
      <Card>
        <CardContent className="pt-6">
          <CalendarView
            entries={
              vehicleId
                ? bookings.map((booking) => toEntry(booking, window.to))
                : bookings.flatMap((booking) => toMoments(booking, window))
            }
            timeZone={timeZone}
            month={month}
          />
          <p className="text-muted-foreground mt-4 text-xs">
            {vehicleId
              ? "This car's rentals in full."
              : "Each pickup and return. Choose a car above to see its rentals in full."}{" "}
            Shows {RENTAL_STATUS_LABELS.booked.toLowerCase()} and{" "}
            {RENTAL_STATUS_LABELS.active.toLowerCase()} rentals. Drafts do not hold a car, so they
            are not shown.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
