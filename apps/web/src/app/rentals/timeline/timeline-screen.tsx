"use client";

import {
  isInStatusGroup,
  TIMELINE_STATUS_GROUP_LABELS,
  TIMELINE_STATUS_GROUPS,
  TIMELINE_ZOOM_LABELS,
  TIMELINE_ZOOMS,
  type TimelineWindow,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Drawer } from "@fleetapp/ui/drawer";
import type { TimelineBar, TimelineScrollTarget } from "@fleetapp/ui/fleet-timeline";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { MultiRecordPicker } from "@fleetapp/ui/multi-record-picker";
import { useIsPhoneWidth } from "@fleetapp/ui/phone-width";
import { ToggleGroup } from "@fleetapp/ui/toggle-group";
import { CalendarCheck, Car, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { DetailLines } from "../../../components/detail-lines";
import { newRentalPath, NEW_RENTAL_STARTS_ON, RENTALS_TIMELINE_PATH } from "../../../lib/paths";
import type { CarGlance } from "./car-glance";
import { useTimelineFilters } from "./timeline-filters";
import { TimelineLegendView, TimelineView } from "./timeline-view";

const STATUS_OPTIONS = TIMELINE_STATUS_GROUPS.map((value) => ({
  value,
  label: TIMELINE_STATUS_GROUP_LABELS[value],
}));
const ZOOM_OPTIONS = TIMELINE_ZOOMS.map((value) => ({ value, label: TIMELINE_ZOOM_LABELS[value] }));
const FOCUS_PARAM = "on";

/** Every word typed appears in the car's rego, make, model or colour. */
function matchesSearch(car: CarGlance, search: string): boolean {
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => car.searchText.includes(word));
}

/**
 * The less used choices, folded away on a phone so the timeline is in view
 * first, open on a computer. Hand-built on the browser's own details
 * element: it opens and closes from the keyboard and is read out as such,
 * with nothing to download.
 */
function MoreChoices({ count, children }: { count: number; children: ReactNode }) {
  const isPhone = useIsPhoneWidth();
  return (
    <details open={!isPhone} className="group rounded-md border">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 font-medium">
        <SlidersHorizontal aria-hidden className="h-4 w-4" />
        More choices{count > 0 ? ` (${count} on)` : ""}
      </summary>
      <div className="grid gap-4 border-t p-3 lg:grid-cols-[auto_1fr_auto] lg:items-end">
        {children}
      </div>
    </details>
  );
}

/** The car quick view: its details and where to go next. */
function CarPanel({ car, onClose }: { car: CarGlance | null; onClose: () => void }) {
  return (
    <Drawer
      isOpen={car !== null}
      onOpenChange={(isOpen) => (isOpen ? null : onClose())}
      title={car?.heading ?? ""}
    >
      {car ? (
        <div className="flex flex-col gap-4">
          <DetailLines lines={car.lines} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild>
              <Link href={car.carHref}>
                <Car aria-hidden />
                Open car page
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={newRentalPath({ vehicleId: car.id })}>
                <Plus aria-hidden />
                New rental for this car
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

/**
 * The timeline with its choices: which cars (search, status, chosen ones),
 * how close (Days, Weeks, Months), Today and Go to a date. Filtering happens
 * here at once; only Go to a date beyond what is loaded asks the server.
 */
export function TimelineScreen(props: {
  cars: readonly CarGlance[];
  bars: readonly TimelineBar[];
  window: TimelineWindow;
}) {
  const { cars, bars, window } = props;
  const router = useRouter();
  const { filters, setFilters, clearFilters } = useTimelineFilters();
  const [scrollTarget, setScrollTarget] = useState<TimelineScrollTarget>({
    date: window.focusDate,
    request: 0,
  });
  const [openCarId, setOpenCarId] = useState<string | null>(null);

  const shownCars = useMemo(
    () =>
      cars.filter(
        (car) =>
          matchesSearch(car, filters.search) &&
          isInStatusGroup(car.status, filters.show) &&
          (filters.carIds.length === 0 || filters.carIds.includes(car.id)),
      ),
    [cars, filters.search, filters.show, filters.carIds],
  );
  const shownIds = useMemo(() => new Set(shownCars.map((car) => car.id)), [shownCars]);
  const rows = useMemo(
    () => shownCars.map((car) => ({ id: car.id, label: car.rego })),
    [shownCars],
  );
  const shownBars = useMemo(() => bars.filter((bar) => shownIds.has(bar.rowId)), [bars, shownIds]);
  const pickable = useMemo(
    () => cars.map((car) => ({ value: car.id, label: car.rego, description: car.description })),
    [cars],
  );
  const hasFilters = filters.search !== "" || filters.show !== "all" || filters.carIds.length > 0;

  function handleDayChosen(rowId: string, date: string): void {
    // A new rental starts today or later.
    if (date >= window.today) {
      router.push(newRentalPath({ vehicleId: rowId, [NEW_RENTAL_STARTS_ON]: date }));
    }
  }

  const choiceCount = (filters.show === "all" ? 0 : 1) + (filters.carIds.length > 0 ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <FormField htmlFor="timeline-search" label="Search cars">
        <Input
          id="timeline-search"
          type="search"
          value={filters.search}
          onChange={(event) => setFilters({ search: event.target.value })}
          placeholder="Rego, make, model or colour"
        />
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          label="Zoom"
          options={ZOOM_OPTIONS}
          value={filters.zoom}
          onValueChange={(zoom) => setFilters({ zoom })}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setScrollTarget((current) => ({ date: window.today, request: current.request + 1 }))
          }
        >
          <CalendarCheck aria-hidden />
          Today
        </Button>
        {hasFilters ? (
          <Button type="button" variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        ) : null}
      </div>
      <MoreChoices count={choiceCount}>
        <ToggleGroup
          label="Show cars"
          options={STATUS_OPTIONS}
          value={filters.show}
          onValueChange={(show) => setFilters({ show })}
        />
        <FormField htmlFor="timeline-cars" label="Only these cars">
          <MultiRecordPicker
            id="timeline-cars"
            records={pickable}
            values={filters.carIds}
            onValuesChange={(carIds) => setFilters({ carIds })}
            placeholder="Choose one or several"
            emptyMessage="No car matches that."
          />
        </FormField>
        <form action={RENTALS_TIMELINE_PATH} className="flex items-end gap-2">
          <FormField htmlFor="timeline-on" label="Go to a date">
            <Input
              id="timeline-on"
              name={FOCUS_PARAM}
              type="date"
              defaultValue={window.focusDate}
            />
          </FormField>
          <Button type="submit" variant="outline">
            Go
          </Button>
        </form>
      </MoreChoices>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No car matches these choices.</p>
      ) : (
        <TimelineView
          rows={rows}
          bars={shownBars}
          startDate={window.startDate}
          days={window.days}
          today={window.today}
          zoom={filters.zoom}
          scrollTarget={scrollTarget}
          onRowChosen={setOpenCarId}
          onDayChosen={handleDayChosen}
        />
      )}
      <TimelineLegendView />
      <CarPanel
        car={cars.find((car) => car.id === openCarId) ?? null}
        onClose={() => setOpenCarId(null)}
      />
    </div>
  );
}
