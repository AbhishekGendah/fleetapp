"use client";

import { DayPilot, DayPilotScheduler } from "@daypilot/daypilot-lite-react";
import * as React from "react";

import { BOOKING_TONE_COLOURS, type BookingTone } from "./booking-tones";
import "./fleet-timeline.css";

export interface TimelineRow {
  id: string;
  /** e.g. the car's rego. */
  label: string;
}

export interface TimelineBar {
  id: string;
  /** The row it sits on. */
  rowId: string;
  /** e.g. "Sam Example". */
  title: string;
  /** Spoken with the title, e.g. "3 Nov to 1 Dec"; the bar is too short to show it. */
  when: string;
  /**
   * Wall-clock moments on the Operator's clock, "2026-11-03T10:00:00" (rule
   * 10: the server converts them). An ongoing rental ends at the window's end.
   */
  start: string;
  end: string;
  /** The rental's page. */
  href: string;
  tone: BookingTone;
}

export interface FleetTimelineProps {
  rows: readonly TimelineRow[];
  bars: readonly TimelineBar[];
  /** The first day shown, "2026-11-02". */
  startDate: string;
  days: number;
}

/** Wide enough for a day's number, and for a short booking to be tapped (WCAG 2.5.8). */
const DAY_WIDTH_PX = 40;
const ROW_HEADER_WIDTH_PX = 96;
const BAR_HEIGHT_PX = 32;

interface BarTags {
  href: string;
  tone: BookingTone;
  label: string;
}

/**
 * The fleet at a glance on DayPilot Lite's Scheduler (Apache-2.0): one row
 * per car, days across, each rental a bar that opens it. Read only: changes
 * are made on the rental's page. Each bar is a plain link, so it is reached
 * with Tab and read out with its dates; the timeline scrolls sideways inside
 * its box on a phone.
 */
export function FleetTimeline({
  rows,
  bars,
  startDate,
  days,
}: FleetTimelineProps): React.JSX.Element {
  const resources = React.useMemo(
    () => rows.map((row) => ({ id: row.id, name: row.label })),
    [rows],
  );
  const events = React.useMemo(
    () =>
      bars.map((bar) => ({
        id: bar.id,
        resource: bar.rowId,
        start: new DayPilot.Date(bar.start),
        end: new DayPilot.Date(bar.end),
        text: bar.title,
        tags: { href: bar.href, tone: bar.tone, label: `${bar.title}, ${bar.when}` } as BarTags,
      })),
    [bars],
  );

  function handleBeforeEventRender(args: DayPilot.SchedulerBeforeEventRenderArgs): void {
    const tags = args.data.tags as BarTags;
    args.data.backColor = BOOKING_TONE_COLOURS[tags.tone];
    args.data.fontColor = "#ffffff";
  }

  function handleBeforeEventDomAdd(args: DayPilot.SchedulerBeforeEventDomAddArgs): void {
    const tags = args.e.data.tags as BarTags;
    args.element = (
      <a className="fleet-timeline-bar" href={tags.href} aria-label={tags.label}>
        {args.e.data.text}
      </a>
    );
  }

  return (
    <div className="fleet-timeline">
      <DayPilotScheduler
        locale="en-au"
        startDate={new DayPilot.Date(startDate)}
        days={days}
        scale="Day"
        timeHeaders={[{ groupBy: "Month" }, { groupBy: "Day", format: "d" }]}
        cellWidth={DAY_WIDTH_PX}
        rowHeaderWidth={ROW_HEADER_WIDTH_PX}
        eventHeight={BAR_HEIGHT_PX}
        heightSpec="Auto"
        resources={resources}
        events={events}
        eventMoveHandling="Disabled"
        eventResizeHandling="Disabled"
        eventClickHandling="Disabled"
        timeRangeSelectedHandling="Disabled"
        onBeforeEventRender={handleBeforeEventRender}
        onBeforeEventDomAdd={handleBeforeEventDomAdd}
      />
    </div>
  );
}
