import type { Metadata } from "next";
import { addDays, startOfDayIn, timelineWindow } from "@fleetapp/core";
import { Card, CardContent } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";

import { appDb } from "../../../lib/app-db";
import { RENTALS_PATH } from "../../../lib/paths";
import { listCalendarBookings } from "../../../lib/rentals/rental-queries";
import { listPastPossessions, listTimelineCars } from "../../../lib/rentals/timeline-queries";
import { requireUser } from "../../../lib/require-user";
import { AppShell } from "../../app-shell";
import { carGlanceOf } from "./car-glance";
import { holdBarOf, pastBarOf, workshopBarOf, type BarContext } from "./timeline-bars";
import { TimelineScreen } from "./timeline-screen";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Fleet timeline" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOCUS_PARAM = "on";

/**
 * The fleet over months: one row per car, the past from who really had
 * each car (rule 15), today on from the bookings, workshop time striped.
 */
export default async function RentalsTimelinePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const timeZone = user.operatorTimezone;
  const asked = (await props.searchParams)[FOCUS_PARAM];
  const now = new Date();
  const window = timelineWindow(typeof asked === "string" ? asked : undefined, now, timeZone);
  const span = {
    from: startOfDayIn(window.startDate, timeZone),
    to: startOfDayIn(addDays(window.startDate, window.days), timeZone),
  };
  const [cars, bookings, past] = await Promise.all([
    listTimelineCars(appDb, user.operatorId),
    listCalendarBookings(appDb, user.operatorId, span),
    listPastPossessions(appDb, user.operatorId, span),
  ]);
  const context: BarContext = { to: span.to, timeZone, today: window.today };
  const bars = [
    ...past.map((possession) => pastBarOf(possession, context)),
    ...bookings.map((booking) => holdBarOf(booking, context)),
    ...cars.flatMap((car) => workshopBarOf(car, context) ?? []),
  ];

  return (
    <AppShell user={user} isWide>
      <PageHeader backHref={RENTALS_PATH} backLabel="Rentals" title="Timeline" />
      <Card>
        <CardContent className="pt-6">
          {cars.length === 0 ? (
            <p className="text-muted-foreground text-sm">Add a car to see it here.</p>
          ) : (
            <TimelineScreen
              cars={cars.map((car) => carGlanceOf(car, bookings, { now, timeZone }))}
              bars={bars}
              window={window}
            />
          )}
          <p className="text-muted-foreground mt-4 text-xs">
            Tap a car&apos;s name for its details, a bar to open the rental, or an empty day to
            start a rental there. Drafts are not shown. On a phone, swipe the timeline sideways.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
