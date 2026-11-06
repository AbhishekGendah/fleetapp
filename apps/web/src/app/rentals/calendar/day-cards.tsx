import { formatShortCalendarDate } from "@fleetapp/core";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";
import { cn } from "@fleetapp/ui/cn";
import { InlineRecordLink, ROW_CLASSES, RowLink } from "@fleetapp/ui/row-link";
import { WeekStrip } from "@fleetapp/ui/week-strip";
import Link from "next/link";

import { SectionCard } from "../../../components/section-card";
import { carPath, rentalPath, renterPath } from "../../../lib/paths";
import {
  CALENDAR_MOMENT_LABELS,
  type CalendarMoment,
  type CalendarMomentKind,
} from "../../../lib/rentals/calendar-moments";

/** Teal for a handover, amber for a return, as on the month grid and the dashboard. */
const MOMENT_TONES: Readonly<Record<CalendarMomentKind, BadgeTone>> = {
  handover: "out",
  return: "attention",
};
const MOMENT_VERBS: Readonly<Record<CalendarMomentKind, string>> = {
  handover: "Handover to",
  return: "Return from",
};
const WEEKDAY = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "UTC" });
const DAY_NUMBER = new Intl.DateTimeFormat("en-AU", { day: "numeric", timeZone: "UTC" });

/** Where the phone's day strip scrolls to: the day's card. */
export function dayAnchorOf(day: string): string {
  return `day-${day}`;
}

/** "Today, Fri 6 Nov", or "Sat 7 Nov". */
function dayHeading(day: string, today: string): string {
  const words = formatShortCalendarDate(day, today);
  return day === today ? `Today, ${words}` : words;
}

/**
 * One handover or return: the time opens the rental (named with the Renter,
 * so it makes sense on its own, WCAG 2.5.3), the name and rego their own
 * records on a computer. On a phone the whole row opens the rental.
 */
function MomentRow({ moment }: { moment: CalendarMoment }) {
  return (
    <li className={cn(ROW_CLASSES, "flex min-h-15 items-center gap-3 border-t py-2")}>
      <span className="text-primary w-17 shrink-0 text-sm font-extrabold tabular-nums">
        <RowLink asChild>
          <Link
            href={rentalPath(moment.rentalId)}
            aria-label={`${MOMENT_VERBS[moment.kind]} ${moment.renterName}, ${moment.time}`}
          >
            {moment.time}
          </Link>
        </RowLink>
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <InlineRecordLink asChild>
          <Link href={renterPath(moment.renterId)}>{moment.renterName}</Link>
        </InlineRecordLink>
        <span className="text-muted-foreground text-sm">
          <InlineRecordLink asChild>
            <Link href={carPath(moment.vehicleId)}>{moment.rego}</Link>
          </InlineRecordLink>{" "}
          · {moment.makeModel}
        </span>
      </span>
      <Badge tone={MOMENT_TONES[moment.kind]}>{CALENDAR_MOMENT_LABELS[moment.kind]}</Badge>
    </li>
  );
}

/** A day's handovers and returns in time order, in a white card named by the day. */
export function DayCard(props: {
  day: string;
  today: string;
  moments: readonly CalendarMoment[];
  /** A fixed id for the day's label, for the day strip's links to scroll to. */
  headingId?: string;
}) {
  return (
    <SectionCard heading={dayHeading(props.day, props.today)} headingId={props.headingId}>
      {props.moments.length === 0 ? (
        <p className="text-muted-foreground border-t py-3 text-sm">
          No handovers or returns this day.
        </p>
      ) : (
        <ul>
          {props.moments.map((moment) => (
            <MomentRow key={moment.key} moment={moment} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * The phone's Day by day: the week's seven days with a dot on those with
 * something on, then a card for each of those days (and the day asked for,
 * even when it is empty).
 */
export function DayByDay(props: {
  week: readonly string[];
  today: string;
  chosenDay: string;
  byDay: ReadonlyMap<string, readonly CalendarMoment[]>;
  dayHref: (day: string) => string;
}) {
  const shownDays = props.week.filter((day) => props.byDay.has(day) || day === props.chosenDay);
  return (
    <div className="flex flex-col gap-4">
      <WeekStrip
        label="Days this week"
        itemsWord="handovers or returns"
        days={props.week.map((day) => {
          const date = new Date(`${day}T00:00:00Z`);
          return {
            date: day,
            weekday: WEEKDAY.format(date),
            dayNumber: DAY_NUMBER.format(date),
            href: `${props.dayHref(day)}#${dayAnchorOf(day)}`,
            hasItems: props.byDay.has(day),
            isToday: day === props.today,
            isChosen: day === props.chosenDay,
          };
        })}
      />
      {shownDays.map((day) => (
        <DayCard
          key={day}
          day={day}
          today={props.today}
          moments={props.byDay.get(day) ?? []}
          headingId={dayAnchorOf(day)}
        />
      ))}
    </div>
  );
}
