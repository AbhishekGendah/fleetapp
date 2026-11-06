"use client";

import {
  isInStatusGroup,
  TIMELINE_STATUS_GROUP_LABELS,
  TIMELINE_STATUS_GROUPS,
  TIMELINE_ZOOM_LABELS,
  TIMELINE_ZOOMS,
  type TimelineWindow,
  type VehicleStatus,
} from "@fleetapp/core";
import type { TimelineBar, TimelineRow } from "@fleetapp/ui/fleet-timeline";
import { ToggleGroup } from "@fleetapp/ui/toggle-group";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { newRentalPath, NEW_RENTAL_STARTS_ON } from "../../../lib/paths";
import { useTimelineFilters } from "./timeline-filters";
import { TimelineLegendView, TimelineView } from "./timeline-view";

const STATUS_OPTIONS = TIMELINE_STATUS_GROUPS.map((value) => ({
  value,
  label: TIMELINE_STATUS_GROUP_LABELS[value],
}));
const ZOOM_OPTIONS = TIMELINE_ZOOMS.map((value) => ({ value, label: TIMELINE_ZOOM_LABELS[value] }));

/** A car's row: its rego opening the car, its make and model under it. */
export interface TimelineCar extends TimelineRow {
  status: VehicleStatus;
}

/**
 * The By car view (was the fleet timeline): cars down the side, days
 * across, each rental a bar that opens it, with how close to zoom and which
 * cars to show. Filtering happens here at once; moving through the weeks is
 * the page's previous and next.
 */
export function ByCarScreen(props: {
  cars: readonly TimelineCar[];
  bars: readonly TimelineBar[];
  window: TimelineWindow;
}) {
  const { cars, bars, window } = props;
  const router = useRouter();
  const { filters, setFilters } = useTimelineFilters();

  const rows = useMemo(
    () => cars.filter((car) => isInStatusGroup(car.status, filters.show)),
    [cars, filters.show],
  );
  const shownIds = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);
  const shownBars = useMemo(() => bars.filter((bar) => shownIds.has(bar.rowId)), [bars, shownIds]);
  const scrollTarget = useMemo(() => ({ date: window.focusDate, request: 0 }), [window.focusDate]);

  function handleDayChosen(rowId: string, date: string): void {
    // A new rental starts today or later.
    if (date >= window.today) {
      router.push(newRentalPath({ vehicleId: rowId, [NEW_RENTAL_STARTS_ON]: date }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          label="Zoom"
          options={ZOOM_OPTIONS}
          value={filters.zoom}
          onValueChange={(zoom) => setFilters({ zoom })}
        />
        <ToggleGroup
          label="Show cars"
          options={STATUS_OPTIONS}
          value={filters.show}
          onValueChange={(show) => setFilters({ show })}
        />
      </div>
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
          onDayChosen={handleDayChosen}
        />
      )}
      <TimelineLegendView />
    </div>
  );
}
