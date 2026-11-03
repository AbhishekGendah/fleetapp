"use client";

import { timelineCellWidth, TIMELINE_ZOOM_LEVELS, type TimelineZoom } from "@fleetapp/core";
import { DayPilot, DayPilotScheduler } from "@daypilot/daypilot-lite-react";
import * as React from "react";

import { BOOKING_TONE_COLOURS, type BookingTone } from "./booking-tones";
import "./fleet-timeline.css";

/** A bar's look: a rental's step, or time in the workshop or off the road. */
export type TimelineTone = BookingTone | "workshop";

export interface TimelineRow {
  id: string;
  /** e.g. the car's rego. */
  label: string;
}

export interface TimelineBar {
  id: string;
  /** The row it sits on. */
  rowId: string;
  /** e.g. "Sam Example", or "In service: gearbox". */
  title: string;
  /** Spoken with the title, e.g. "3 Nov 2026, 9:00 am to 1 Dec 2026, 9:00 am". */
  when: string;
  /**
   * Wall-clock moments on the Operator's clock, "2026-11-03T10:00:00" (rule
   * 10: the server converts them). An ongoing one ends at the stretch's end.
   */
  start: string;
  end: string;
  /** The rental's page; a workshop block has none. */
  href?: string;
  tone: TimelineTone;
}

/** Asks the timeline to scroll to a day; a new `request` number scrolls again to the same day. */
export interface TimelineScrollTarget {
  date: string;
  request: number;
}

export interface FleetTimelineProps {
  rows: readonly TimelineRow[];
  bars: readonly TimelineBar[];
  /** The first day loaded, "2026-08-03", and how many. */
  startDate: string;
  days: number;
  /** Shaded on every row. */
  today: string;
  zoom: TimelineZoom;
  scrollTarget: TimelineScrollTarget;
  /** A car's name pressed: e.g. to show the car. */
  onRowChosen?: (rowId: string) => void;
  /** An empty day tapped on a row: e.g. to start a rental there. */
  onDayChosen?: (rowId: string, date: string) => void;
}

const ROW_HEADER_WIDTH_PX = 112;
const BAR_HEIGHT_PX = 36;
/** Even a one-day booking zoomed right out can be tapped (WCAG 2.5.8). */
const BAR_MIN_WIDTH_PX = 24;
const DAY_FORMAT = "yyyy-MM-dd";
const WORKSHOP_CLASS = "fleet-timeline-workshop";
const TODAY_COLOUR = "var(--color-primary-soft)";
/** Before the box is measured: about a phone's width. */
const FIRST_GUESS_WIDTH_PX = 360;

type TimeHeaders = { groupBy: "Month" | "Week" | "Day"; format?: string }[];

const TIME_HEADERS: Readonly<Record<TimelineZoom, TimeHeaders>> = {
  days: [{ groupBy: "Month" }, { groupBy: "Day", format: "ddd d" }],
  weeks: [{ groupBy: "Month" }, { groupBy: "Week" }],
  months: [{ groupBy: "Month" }, { groupBy: "Week" }],
};

interface BarTags {
  href: string | undefined;
  tone: TimelineTone;
  label: string;
}

/** The box's width, kept up to date as the window is resized or the phone turned. */
function useBoxWidth(box: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = React.useState(FIRST_GUESS_WIDTH_PX);
  React.useEffect(() => {
    const element = box.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [box]);
  return width;
}

function handleBeforeEventRender(args: DayPilot.SchedulerBeforeEventRenderArgs): void {
  const tags = args.data.tags as BarTags;
  if (tags.tone === "workshop") {
    args.data.cssClass = WORKSHOP_CLASS;
    return;
  }
  args.data.backColor = BOOKING_TONE_COLOURS[tags.tone];
  args.data.fontColor = "#ffffff";
}

/** A rental's bar is a plain link, so Tab reaches it and it is read out with its dates. */
function handleBeforeEventDomAdd(args: DayPilot.SchedulerBeforeEventDomAddArgs): void {
  const tags = args.e.data.tags as BarTags;
  const text = args.e.data.text as string;
  args.element = tags.href ? (
    <a className="fleet-timeline-bar" href={tags.href} aria-label={tags.label}>
      {text}
    </a>
  ) : (
    <span className="fleet-timeline-bar" aria-label={tags.label}>
      {text}
    </span>
  );
}

/**
 * The fleet over months on DayPilot Lite's Scheduler (Apache-2.0): one row
 * per car, each rental a bar that opens it, workshop time striped, today
 * shaded. It fills its box's width at each zoom, never narrower than stays
 * readable (then it swipes sideways inside its box), and scrolls smoothly
 * through the stretch it is given. Read only: changes are made on the
 * rental's page. Each car's name is a button.
 */
export function FleetTimeline(props: FleetTimelineProps): React.JSX.Element {
  const { rows, bars, startDate, days, today, zoom, scrollTarget, onRowChosen, onDayChosen } =
    props;
  const box = React.useRef<HTMLDivElement>(null);
  const scheduler = React.useRef<DayPilotScheduler>(null);
  const boxWidth = useBoxWidth(box);
  const level = TIMELINE_ZOOM_LEVELS[zoom];

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

  const cellWidth = timelineCellWidth(boxWidth, ROW_HEADER_WIDTH_PX, zoom);
  // Again whenever the cells change width: a scroll worked out at the old width lands elsewhere.
  React.useEffect(() => {
    scheduler.current?.control.scrollTo(new DayPilot.Date(scrollTarget.date));
  }, [scrollTarget, zoom, cellWidth]);

  function handleBeforeCellRender(args: DayPilot.SchedulerBeforeCellRenderArgs): void {
    const first = args.cell.start.toString(DAY_FORMAT);
    const afterLast = args.cell.end.toString(DAY_FORMAT);
    if (first <= today && today < afterLast) {
      args.cell.properties.backColor = TODAY_COLOUR;
    }
  }

  function handleBeforeRowHeaderDomAdd(args: DayPilot.SchedulerBeforeRowHeaderDomAddArgs): void {
    if (!onRowChosen) {
      return;
    }
    const rowId = String(args.row.id);
    args.element = (
      <button
        type="button"
        className="fleet-timeline-row-button"
        onClick={() => onRowChosen(rowId)}
      >
        {args.row.name}
      </button>
    );
  }

  return (
    <div ref={box} className="fleet-timeline">
      <DayPilotScheduler
        ref={scheduler}
        locale="en-au"
        startDate={new DayPilot.Date(startDate)}
        days={days}
        scale={level.cell === "week" ? "Week" : "Day"}
        timeHeaders={TIME_HEADERS[zoom]}
        cellWidth={cellWidth}
        rowHeaderWidth={ROW_HEADER_WIDTH_PX}
        eventHeight={BAR_HEIGHT_PX}
        durationBarVisible={false}
        // The bar's own link holds its text; DayPilot's floating copy would draw it twice.
        floatingEvents={false}
        eventMinWidth={BAR_MIN_WIDTH_PX}
        heightSpec="Auto"
        // Every bar and car stays on the page, not only those scrolled into view, so the
        // keyboard and screen readers reach them all. A fleet's bars are few enough.
        dynamicEventRendering="Disabled"
        progressiveRowRendering={false}
        resources={resources}
        events={events}
        eventMoveHandling="Disabled"
        eventResizeHandling="Disabled"
        eventClickHandling="Disabled"
        // A tap on an empty day selects it; the selection is cleared at once, it only chooses.
        timeRangeSelectedHandling={onDayChosen ? "Enabled" : "Disabled"}
        onTimeRangeSelected={(args) => {
          args.control.clearSelection();
          onDayChosen?.(String(args.resource), args.start.toString(DAY_FORMAT));
        }}
        onBeforeCellRender={handleBeforeCellRender}
        onBeforeEventRender={handleBeforeEventRender}
        onBeforeEventDomAdd={handleBeforeEventDomAdd}
        onBeforeRowHeaderDomAdd={handleBeforeRowHeaderDomAdd}
      />
    </div>
  );
}

/** What each colour means, under the timeline. */
export function TimelineLegend(): React.JSX.Element {
  const keys: readonly { label: string; className: string; colour?: string }[] = [
    { label: "Booked", className: "", colour: BOOKING_TONE_COLOURS.booked },
    { label: "Out", className: "", colour: BOOKING_TONE_COLOURS.active },
    { label: "Finished", className: "", colour: BOOKING_TONE_COLOURS.finished },
    { label: "Workshop or off road", className: WORKSHOP_CLASS },
    { label: "Today", className: "", colour: TODAY_COLOUR },
  ];
  return (
    <ul aria-label="What the colours mean" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {keys.map((key) => (
        <li key={key.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block h-3 w-5 rounded-sm border ${key.className}`}
            style={key.colour ? { background: key.colour } : undefined}
          />
          {key.label}
        </li>
      ))}
    </ul>
  );
}
