import { isCalendarDate } from "@fleetapp/core";
import { permanentRedirect } from "next/navigation";

import { calendarPath } from "../../../lib/paths";
import { TIMELINE_ADDRESS_CHOICES } from "../calendar/calendar-window";

/** The old timeline's "go to a date". */
const OLD_FOCUS_PARAM = "on";

/**
 * The fleet timeline is now the Calendar's By car view: an old link or
 * bookmark opens it there, on the day it named, with its zoom and the
 * cars it showed.
 */
export default async function RentalsTimelinePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const params = await props.searchParams;
  const asked = params[OLD_FOCUS_PARAM];
  const target = calendarPath({
    isByCar: true,
    day: typeof asked === "string" && isCalendarDate(asked) ? asked : undefined,
  });
  const kept = new URLSearchParams(
    TIMELINE_ADDRESS_CHOICES.flatMap((name) => {
      const value = params[name];
      return typeof value === "string" ? [[name, value]] : [];
    }),
  ).toString();
  permanentRedirect(kept ? `${target}&${kept}` : target);
}
