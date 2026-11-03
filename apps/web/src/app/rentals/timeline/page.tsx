import {
  addDays,
  RENTAL_STATUS_LABELS,
  startOfDayIn,
  TIMELINE_DAYS,
  TIMELINE_STEP_DAYS,
  timelineStart,
  todayInTimeZone,
  mondayOf,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import { RENTALS_PATH, RENTALS_TIMELINE_PATH } from "../../../lib/paths";
import { listPickableCars } from "../../../lib/rentals/pickable-records";
import { listCalendarBookings } from "../../../lib/rentals/rental-queries";
import { requireUser } from "../../../lib/require-user";
import { AppShell } from "../../app-shell";
import { timelineBarOf } from "./timeline-bars";
import { TimelineView } from "./timeline-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FROM_PARAM = "from";

function weekHref(startDate: string): string {
  return `${RENTALS_TIMELINE_PATH}?${new URLSearchParams({ [FROM_PARAM]: startDate }).toString()}`;
}

/** The fleet at a glance: one row per car, four weeks across, each booking a bar. */
export default async function RentalsTimelinePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const timeZone = user.operatorTimezone;
  const asked = (await props.searchParams)[FROM_PARAM];
  const now = new Date();
  const startDate = timelineStart(typeof asked === "string" ? asked : undefined, now, timeZone);
  const isThisWeek = startDate === mondayOf(todayInTimeZone(now, timeZone));
  const window = {
    from: startOfDayIn(startDate, timeZone),
    to: startOfDayIn(addDays(startDate, TIMELINE_DAYS), timeZone),
  };
  const [cars, bookings] = await Promise.all([
    listPickableCars(appDb, user.operatorId),
    listCalendarBookings(appDb, user.operatorId, window),
  ]);

  return (
    <AppShell user={user}>
      <PageHeader backHref={RENTALS_PATH} backLabel="Rentals" title="Timeline" />
      <nav aria-label="Weeks shown" className="flex flex-wrap gap-2">
        {isThisWeek ? null : (
          <Button asChild variant="outline">
            <Link href={weekHref(addDays(startDate, -TIMELINE_STEP_DAYS))}>
              <ChevronLeft aria-hidden />
              Earlier
            </Link>
          </Button>
        )}
        {isThisWeek ? null : (
          <Button asChild variant="outline">
            <Link href={RENTALS_TIMELINE_PATH}>This week</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href={weekHref(addDays(startDate, TIMELINE_STEP_DAYS))}>
            Later
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </nav>
      <Card>
        <CardContent className="pt-6">
          {cars.length === 0 ? (
            <p className="text-muted-foreground text-sm">Add a car to see it here.</p>
          ) : (
            <TimelineView
              rows={cars.map((car) => ({ id: car.value, label: car.label }))}
              bars={bookings.map((booking) => timelineBarOf(booking, { ...window, timeZone }))}
              startDate={startDate}
              days={TIMELINE_DAYS}
            />
          )}
          <p className="text-muted-foreground mt-4 text-xs">
            Each car&apos;s {RENTAL_STATUS_LABELS.booked.toLowerCase()} and{" "}
            {RENTAL_STATUS_LABELS.active.toLowerCase()} rentals. Open one to change it. Rentals
            already back, and drafts, are not shown. On a phone, swipe the timeline sideways.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
