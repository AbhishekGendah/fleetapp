import { Button } from "@fleetapp/ui/button";
import { cn } from "@fleetapp/ui/cn";
import type { PickableRecord } from "@fleetapp/ui/record-picker";
import { SegmentedLinks } from "@fleetapp/ui/segmented-links";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { calendarPath, type CalendarAddress } from "../../../lib/paths";
import { CarFilter } from "./car-filter";

/** One way through time: what is showing, and the stretch before and after it. */
export interface PeriodSteps {
  label: string;
  /** e.g. "month", "week", "two weeks": read out as "Previous month". */
  stepName: string;
  previous: CalendarAddress;
  next: CalendarAddress;
  /** On a phone only, or on a computer only, when the two show different stretches. */
  shownOn?: "phone" | "computer";
}

const SHOWN_ON_CLASSES = {
  phone: "flex md:hidden",
  computer: "hidden md:flex",
} as const;

/** ‹ November 2026 › */
function PeriodNav({ steps }: { steps: PeriodSteps }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        steps.shownOn ? SHOWN_ON_CLASSES[steps.shownOn] : "flex",
      )}
    >
      <Button asChild variant="outline" size="icon">
        <Link href={calendarPath(steps.previous)} aria-label={`Previous ${steps.stepName}`}>
          <ChevronLeft aria-hidden />
        </Link>
      </Button>
      <span className="text-primary min-w-36 text-center text-lg font-extrabold">
        {steps.label}
      </span>
      <Button asChild variant="outline" size="icon">
        <Link href={calendarPath(steps.next)} aria-label={`Next ${steps.stepName}`}>
          <ChevronRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

/**
 * The Calendar's choices above the view: previous and next, Today, the car
 * shown, and the view (Month, or Day by day on a phone; By car). Each is a
 * link, so every choice has its own address.
 */
export function CalendarToolbar(props: {
  periods: readonly PeriodSteps[];
  isByCar: boolean;
  vehicleId: string | undefined;
  cars: readonly PickableRecord[];
  /** The view and stretch showing now, for the car filter to keep. */
  address: Omit<CalendarAddress, "vehicleId">;
}) {
  const { isByCar, vehicleId } = props;
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
      <SegmentedLinks
        label="How to show the calendar"
        className="lg:order-last"
        links={[
          {
            href: calendarPath({ vehicleId }),
            label: "Month",
            phoneLabel: "Day by day",
            isCurrent: !isByCar,
          },
          { href: calendarPath({ isByCar: true, vehicleId }), label: "By car", isCurrent: isByCar },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start">
        {props.periods.map((steps) => (
          <PeriodNav key={`${steps.stepName}-${steps.shownOn ?? "both"}`} steps={steps} />
        ))}
        <Button asChild variant="outline">
          <Link href={calendarPath({ isByCar, vehicleId })}>Today</Link>
        </Button>
      </div>
      <CarFilter cars={props.cars} vehicleId={vehicleId} address={props.address} />
    </div>
  );
}
