import {
  formatShortDayInTimeZone,
  formatTimeInTimeZone,
  todayInTimeZone,
  VEHICLE_STATUSES_IN_WORKSHOP,
  type RentalMoment,
  type VehicleStatus,
} from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { SectionLabel } from "@fleetapp/ui/card";
import { cn } from "@fleetapp/ui/cn";
import { InlineRecordLink, ROW_CLASSES, RowLink } from "@fleetapp/ui/row-link";
import { CarFront, ChevronRight, Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import type * as React from "react";

import type { AttentionList } from "../../lib/dashboard/attention-items";
import { DASHBOARD_LIST_LENGTH } from "../../lib/dashboard/fleet-overview";
import type { DashboardData } from "../../lib/dashboard/load-dashboard";
import type { RentalThisWeek } from "../../lib/dashboard/rentals-this-week";
import {
  ATTENTION_PATH,
  calendarDayPath,
  CARS_PATH,
  carPath,
  carsWithStatusPath,
  NEW_CAR_PATH,
  NEW_RENTAL_PATH,
  NEW_RENTER_PATH,
  rentalPath,
  renterPath,
} from "../../lib/paths";
import { WORKSHOP_FILTER_VALUE } from "../../lib/vehicles/vehicle-queries";
import { SectionCard } from "../../components/section-card";
import { AttentionBadge, AttentionText } from "../attention/attention-row";

const ROW_LINE_CLASSES = "flex items-center gap-3 border-t py-2";
const CHEVRON_CLASSES = "text-teal size-5 shrink-0";

function SeeAllLink({ total }: { total: number }) {
  return (
    <Link
      href={ATTENTION_PATH}
      className="text-teal hover:text-primary flex min-h-12 items-center justify-center gap-1 border-t text-sm font-bold"
    >
      See all {total}
      <span className="hidden md:inline"> that need attention</span>
      <span aria-hidden>›</span>
    </Link>
  );
}

/**
 * The five most urgent things to do (the full list is a tap away), with how
 * many there are in all. Names and regos open their record on a computer;
 * the rest of the row opens the place to fix it.
 */
export function NeedsAttentionCard({ attention }: { attention: AttentionList }) {
  const shown = attention.items.slice(0, DASHBOARD_LIST_LENGTH);
  return (
    <SectionCard
      headingId="attention-heading"
      heading="Needs attention"
      aside={
        attention.total > 0 ? (
          <Badge tone="danger" className="min-w-7 justify-center">
            {attention.total}
            <span className="sr-only"> in all</span>
          </Badge>
        ) : null
      }
    >
      {shown.length === 0 ? (
        <p className="text-muted-foreground border-t py-3 text-sm">
          Nothing needs attention. Nice.
        </p>
      ) : (
        <ul aria-label="Most urgent">
          {shown.map((item) => (
            <li key={item.key} className={cn(ROW_CLASSES, ROW_LINE_CLASSES, "min-h-15")}>
              <AttentionText item={item} />
              <AttentionBadge item={item} />
            </li>
          ))}
        </ul>
      )}
      {attention.total > shown.length ? <SeeAllLink total={attention.total} /> : null}
    </SectionCard>
  );
}

const TODAY_MOMENTS: readonly RentalMoment[] = ["pickup_today", "returning_today"];
const LATER_MOMENTS: readonly RentalMoment[] = ["starting_this_week", "ending_this_week"];
const RETURN_MOMENTS: readonly RentalMoment[] = ["returning_today", "ending_this_week"];

interface WeekMoment {
  rental: RentalThisWeek;
  at: Date;
  /** "Handover to" or "Return from", followed by the Renter's name. */
  verb: string;
}

function weekMoments(rentals: readonly RentalThisWeek[], moments: readonly RentalMoment[]) {
  return rentals
    .filter((rental) => moments.includes(rental.moment))
    .flatMap((rental): WeekMoment[] => {
      const isReturn = RETURN_MOMENTS.includes(rental.moment);
      const at = isReturn ? rental.plannedEnd : rental.plannedStart;
      return at ? [{ rental, at, verb: isReturn ? "Return from" : "Handover to" }] : [];
    })
    .sort((first, second) => first.at.getTime() - second.at.getTime());
}

/** "Handover to" opens the rental (spoken with the name, WCAG 2.5.3); the name opens the Renter. */
function MomentWords({ moment }: { moment: WeekMoment }) {
  const name = moment.rental.renterFullName;
  return (
    <>
      <RowLink asChild>
        <Link href={rentalPath(moment.rental.id)} aria-label={`${moment.verb} ${name}`}>
          {moment.verb}
        </Link>
      </RowLink>{" "}
      <InlineRecordLink asChild>
        <Link href={renterPath(moment.rental.renterId)}>{name}</Link>
      </InlineRecordLink>
    </>
  );
}

function TodayRow({ moment, timeZone }: { moment: WeekMoment; timeZone: string }) {
  const { rental } = moment;
  return (
    <li className={cn(ROW_CLASSES, ROW_LINE_CLASSES, "min-h-16")}>
      <span className="text-primary w-17 shrink-0 font-extrabold tabular-nums">
        {formatTimeInTimeZone(moment.at, timeZone)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="font-bold">
          <MomentWords moment={moment} />
        </span>
        <span className="text-muted-foreground text-sm">
          {rental.make} {rental.model} ·{" "}
          <InlineRecordLink asChild>
            <Link href={carPath(rental.vehicleId)}>{rental.rego}</Link>
          </InlineRecordLink>
        </span>
      </span>
      <ChevronRight aria-hidden className={CHEVRON_CLASSES} />
    </li>
  );
}

function LaterRow(props: { moment: WeekMoment; timeZone: string; today: string }) {
  const day = todayInTimeZone(props.moment.at, props.timeZone);
  return (
    <li className={cn(ROW_CLASSES, "flex min-h-11 items-center gap-1.5 text-sm")}>
      <InlineRecordLink asChild>
        <Link href={calendarDayPath(day)}>
          {formatShortDayInTimeZone(props.moment.at, props.timeZone, props.today)}
        </Link>
      </InlineRecordLink>
      <span aria-hidden>·</span>
      <span className="min-w-0 flex-1 font-semibold">
        <MomentWords moment={props.moment} />
      </span>
      <ChevronRight aria-hidden className={CHEVRON_CLASSES} />
    </li>
  );
}

/** Today's handovers and returns by time, then the rest of the week's. On the Operator's clock (rule 10). */
export function TodayCard({ data, timeZone }: { data: DashboardData; timeZone: string }) {
  const today = weekMoments(data.rentals, TODAY_MOMENTS);
  const later = weekMoments(data.rentals, LATER_MOMENTS);
  return (
    <SectionCard headingId="today-heading" heading="Today">
      {today.length === 0 ? (
        <p className="text-muted-foreground border-t py-3 text-sm">Nothing today.</p>
      ) : (
        <ul aria-label="Today">
          {today.map((moment) => (
            <TodayRow key={moment.rental.id} moment={moment} timeZone={timeZone} />
          ))}
        </ul>
      )}
      <section aria-labelledby="later-heading" className="flex flex-col border-t pt-3 pb-2">
        <SectionLabel as="h3" id="later-heading" className="pb-1">
          Later this week
        </SectionLabel>
        {later.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">Nothing later this week.</p>
        ) : (
          <ul aria-label="Later this week">
            {later.map((moment) => (
              <LaterRow
                key={moment.rental.id}
                moment={moment}
                timeZone={timeZone}
                today={data.window.today}
              />
            ))}
          </ul>
        )}
      </section>
    </SectionCard>
  );
}

const CAR_TILE_CLASSES =
  "focus-visible:ring-ring flex min-h-21 flex-col items-center justify-center rounded-xl font-bold outline-none hover:brightness-95 focus-visible:ring-2";

function CarTile(props: { href: string; count: number; label: string; className: string }) {
  return (
    <Link href={props.href} className={cn(CAR_TILE_CLASSES, props.className)}>
      <span className="text-3xl leading-tight font-extrabold tabular-nums">{props.count}</span>
      {/* The space keeps the spoken name "7 Out", not "7Out": the two lines are separate boxes. */}
      <span className="text-sm"> {props.label}</span>
    </Link>
  );
}

/** Where the cars are, as counts that open the cars list filtered to them. */
export function YourCarsCard({ data }: { data: DashboardData }) {
  const countOf = (statuses: readonly VehicleStatus[]) =>
    statuses.reduce((sum, status) => sum + (data.fleetCounts[status] ?? 0), 0);
  const total = Object.values(data.fleetCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  return (
    <SectionCard
      headingId="cars-heading"
      heading="Your cars"
      aside={
        <Link
          href={CARS_PATH}
          className="text-teal hover:text-primary inline-flex min-h-11 items-center text-sm font-bold"
        >
          All {total}
        </Link>
      }
    >
      <div className="grid grid-cols-3 gap-2 pb-3">
        <CarTile
          href={carsWithStatusPath("rented")}
          count={countOf(["rented"])}
          label="Out"
          className="bg-primary-soft text-primary"
        />
        <CarTile
          href={carsWithStatusPath("available")}
          count={countOf(["available"])}
          label="Available"
          className="bg-primary-soft text-primary"
        />
        <CarTile
          href={carsWithStatusPath(WORKSHOP_FILTER_VALUE)}
          count={countOf(VEHICLE_STATUSES_IN_WORKSHOP)}
          label="Workshop"
          className="bg-attention-soft text-attention"
        />
      </div>
    </SectionCard>
  );
}

const QUICK_ACTION_CLASSES =
  "h-auto min-h-18 flex-col gap-1.5 px-2 text-sm font-bold md:min-h-12 md:flex-row md:px-4 [&_svg]:size-5";

/** The three things done most from home. Icons above the words on a phone, beside them on a computer. */
export function QuickActions() {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button asChild className={QUICK_ACTION_CLASSES}>
        <Link href={NEW_RENTAL_PATH}>
          <Plus aria-hidden />
          New rental
        </Link>
      </Button>
      <Button asChild variant="soft" className={QUICK_ACTION_CLASSES}>
        <Link href={NEW_CAR_PATH}>
          <CarFront aria-hidden />
          Add car
        </Link>
      </Button>
      <Button asChild variant="soft" className={QUICK_ACTION_CLASSES}>
        <Link href={NEW_RENTER_PATH}>
          <UserPlus aria-hidden />
          Add Renter
        </Link>
      </Button>
    </div>
  );
}
