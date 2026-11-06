import type { Metadata } from "next";
import { addDays, startOfDayIn, timelineWindow, todayInTimeZone } from "@fleetapp/core";
import type { CalendarEntry } from "@fleetapp/ui/bookings-calendar";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent } from "@fleetapp/ui/card";
import { Plus } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import { calendarPath, carPath, NEW_RENTAL_PATH, rentalPath } from "../../../lib/paths";
import {
  calendarMoments,
  momentLabel,
  momentsByDay,
  monthLabel,
  spanLabel,
  weekDays,
  type CalendarMoment,
} from "../../../lib/rentals/calendar-moments";
import { listPickableCars } from "../../../lib/rentals/pickable-records";
import { listCalendarBookings } from "../../../lib/rentals/rental-queries";
import { listPastPossessions, listTimelineCars } from "../../../lib/rentals/timeline-queries";
import { requireUser, type SignedInUser } from "../../../lib/require-user";
import { AppShell } from "../../app-shell";
import { ByCarScreen } from "./by-car-screen";
import { CalendarToolbar, type PeriodSteps } from "./calendar-toolbar";
import { CalendarView } from "./calendar-view";
import {
  BY_CAR_DAYS,
  calendarRequestOf,
  monthWindow,
  neighbouringDays,
  neighbouringMonths,
  shownDay,
  shownMonth,
  type CalendarRequest,
} from "./calendar-window";
import { DayByDay, DayCard } from "./day-cards";
import { holdBarOf, pastBarOf, workshopBarOf, type BarContext } from "./timeline-bars";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Calendar" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS_PER_WEEK = 7;

function toEntry(moment: CalendarMoment): CalendarEntry {
  return {
    id: moment.key,
    title: momentLabel(moment),
    date: moment.day,
    order: moment.at.getTime(),
    href: rentalPath(moment.rentalId),
    tone: moment.kind,
  };
}

/**
 * Month on a computer (the month grid, and the day asked for listed above
 * it), Day by day on a phone (the week's strip, then a card per day).
 */
async function MonthView({
  user,
  request,
  today,
}: {
  user: SignedInUser;
  request: CalendarRequest;
  today: string;
}) {
  const timeZone = user.operatorTimezone;
  const month = shownMonth(request, today);
  const day = shownDay(request, today);
  const window = monthWindow(month, timeZone);
  const moments = calendarMoments(
    await listCalendarBookings(appDb, user.operatorId, {
      ...window,
      vehicleId: request.vehicleId,
    }),
    window,
    timeZone,
  );
  const byDay = momentsByDay(moments);
  const vehicleId = request.vehicleId;
  return (
    <>
      <div className="flex flex-col gap-4 md:hidden">
        <DayByDay
          week={weekDays(day)}
          today={today}
          chosenDay={day}
          byDay={byDay}
          dayHref={(shown) => calendarPath({ day: shown, vehicleId })}
        />
      </div>
      <div className="hidden flex-col gap-4 md:flex">
        {request.day ? (
          <DayCard day={request.day} today={today} moments={byDay.get(request.day) ?? []} />
        ) : null}
        <Card>
          <CardContent className="p-0">
            <CalendarView
              entries={moments.map(toEntry)}
              timeZone={timeZone}
              month={month}
              chosenDay={request.day}
              vehicleId={vehicleId}
            />
          </CardContent>
        </Card>
        <p className="text-muted-foreground text-sm">
          Each handover and return of a booked or out rental. Drafts do not hold a car, so they are
          not shown.
        </p>
      </div>
    </>
  );
}

/** By car: one row per car (or the car chosen), two weeks across from the day asked for. */
async function ByCarView({
  user,
  request,
  now,
}: {
  user: SignedInUser;
  request: CalendarRequest;
  now: Date;
}) {
  const timeZone = user.operatorTimezone;
  const window = timelineWindow(request.day, now, timeZone);
  const span = {
    from: startOfDayIn(window.startDate, timeZone),
    to: startOfDayIn(addDays(window.startDate, window.days), timeZone),
  };
  const [allCars, bookings, past] = await Promise.all([
    listTimelineCars(appDb, user.operatorId),
    listCalendarBookings(appDb, user.operatorId, span),
    listPastPossessions(appDb, user.operatorId, span),
  ]);
  const cars = request.vehicleId ? allCars.filter((car) => car.id === request.vehicleId) : allCars;
  const context: BarContext = { to: span.to, timeZone, today: window.today };
  const bars = [
    ...past.map((possession) => pastBarOf(possession, context)),
    ...bookings.map((booking) => holdBarOf(booking, context)),
    ...cars.flatMap((car) => workshopBarOf(car, context) ?? []),
  ];
  return (
    <Card>
      <CardContent className="pt-6">
        {cars.length === 0 ? (
          <p className="text-muted-foreground text-sm">Add a car to see it here.</p>
        ) : (
          <ByCarScreen
            cars={cars.map((car) => ({
              id: car.id,
              label: car.rego,
              description: `${car.make} ${car.model}`,
              href: carPath(car.id),
              status: car.status,
            }))}
            bars={bars}
            window={window}
          />
        )}
        <p className="text-muted-foreground mt-4 text-sm">
          A rego opens its car, a bar its rental, and an empty day starts a rental there. Drafts are
          not shown. On a phone, swipe the cars sideways.
        </p>
      </CardContent>
    </Card>
  );
}

/** Previous and next: a month (or a week on a phone), or two weeks By car. */
function periodsOf(request: CalendarRequest, today: string): PeriodSteps[] {
  const { vehicleId } = request;
  if (request.isByCar) {
    const from = request.day ?? today;
    const steps = neighbouringDays(from, BY_CAR_DAYS);
    return [
      {
        label: spanLabel(from, addDays(from, BY_CAR_DAYS - 1)),
        stepName: "two weeks",
        previous: { isByCar: true, day: steps.previous, vehicleId },
        next: { isByCar: true, day: steps.next, vehicleId },
      },
    ];
  }
  const month = shownMonth(request, today);
  const months = neighbouringMonths(month);
  const week = weekDays(shownDay(request, today));
  const weeks = neighbouringDays(week[0] ?? today, DAYS_PER_WEEK);
  return [
    {
      label: spanLabel(week[0] ?? today, week.at(-1) ?? today),
      stepName: "week",
      previous: { day: weeks.previous, vehicleId },
      next: { day: weeks.next, vehicleId },
      shownOn: "phone",
    },
    {
      label: monthLabel(month),
      stepName: "month",
      previous: { month: months.previous, vehicleId },
      next: { month: months.next, vehicleId },
      shownOn: "computer",
    },
  ];
}

/**
 * The Calendar (docs/plans/look-and-feel.md, "Calendar page"): Month (Day
 * by day on a phone) or By car, previous and next, Today, one car or all,
 * and New rental. Everything it shows is in the page address.
 */
export default async function RentalsCalendarPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const request = calendarRequestOf(await props.searchParams);
  const now = new Date();
  const today = todayInTimeZone(now, user.operatorTimezone);
  const cars = await listPickableCars(appDb, user.operatorId);

  return (
    <AppShell user={user} isWide={request.isByCar}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-primary text-2xl font-extrabold">Calendar</h1>
        <Button asChild>
          <Link href={NEW_RENTAL_PATH}>
            <Plus aria-hidden />
            New rental
          </Link>
        </Button>
      </div>
      <CalendarToolbar
        periods={periodsOf(request, today)}
        isByCar={request.isByCar}
        vehicleId={request.vehicleId}
        cars={cars}
        address={{ isByCar: request.isByCar, month: request.month, day: request.day }}
      />
      {request.isByCar ? (
        <ByCarView user={user} request={request} now={now} />
      ) : (
        <MonthView user={user} request={request} today={today} />
      )}
    </AppShell>
  );
}
