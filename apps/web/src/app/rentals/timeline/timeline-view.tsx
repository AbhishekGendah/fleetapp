"use client";

import dynamic from "next/dynamic";

/**
 * The timeline, loaded in the browser only: it measures its box to lay
 * itself out, and keeping it out of the first download keeps the Rentals
 * pages that link here light.
 */
export const TimelineView = dynamic(
  () => import("@fleetapp/ui/fleet-timeline").then((module) => module.FleetTimeline),
  {
    ssr: false,
    loading: () => <p className="text-muted-foreground text-sm">Loading the timeline…</p>,
  },
);

export const TimelineLegendView = dynamic(
  () => import("@fleetapp/ui/fleet-timeline").then((module) => module.TimelineLegend),
  { ssr: false },
);
