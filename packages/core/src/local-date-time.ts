import { isCalendarDate } from "./calendar-dates";
import { MILLISECONDS_PER_MINUTE } from "./time-units";

/**
 * A date and time on a local clock, as a date-and-time box gives it:
 * "2026-10-30T14:15". Moments are stored in UTC and typed on the
 * Operator's clock (rule 10), so these convert between the two, daylight
 * saving included.
 */

/** Further than any zone's daylight-saving change is from a clock time, so both offsets are seen. */
const OFFSET_PROBE_MINUTES = 12 * 60;

const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsOf(localDateTime: string): LocalParts | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(localDateTime);
  if (!match || !isCalendarDate(match[1]!)) {
    return null;
  }
  const [year, month, day] = match[1]!.split("-").map(Number) as [number, number, number];
  return { year, month, day, hour: Number(match[2]), minute: Number(match[3]) };
}

/** What a zone's clock shows at a moment, as minutes since 1970 on that clock. */
function clockMinutes(moment: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((each) => each.type === type)?.value);
  return (
    Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) /
    MILLISECONDS_PER_MINUTE
  );
}

/** "YYYY-MM-DDTHH:mm" that is a real date and time of day. */
export function isLocalDateTime(value: string): boolean {
  return partsOf(value) !== null;
}

/**
 * The moment a local clock time names, or null if that time never happens
 * there (the hour skipped when daylight saving starts). When the clocks go
 * back an hour repeats; the first one (still daylight time) is taken.
 */
export function localDateTimeToUtc(localDateTime: string, timeZone: string): Date | null {
  const parts = partsOf(localDateTime);
  if (!parts) {
    return null;
  }
  const wantedMinutes =
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) /
    MILLISECONDS_PER_MINUTE;
  // Trying the offsets in force half a day before and after finds every
  // moment that shows this clock time: none in the skipped hour, two in the repeated one.
  const candidates = [-1, 1]
    .map((side) => {
      const probe = new Date(
        (wantedMinutes + side * OFFSET_PROBE_MINUTES) * MILLISECONDS_PER_MINUTE,
      );
      const offsetMinutes =
        clockMinutes(probe, timeZone) - probe.getTime() / MILLISECONDS_PER_MINUTE;
      return new Date((wantedMinutes - offsetMinutes) * MILLISECONDS_PER_MINUTE);
    })
    .filter((moment) => clockMinutes(moment, timeZone) === wantedMinutes)
    .sort((left, right) => left.getTime() - right.getTime());
  return candidates[0] ?? null;
}

/** A moment as a local date-and-time box shows it, e.g. "2026-10-30T14:15". */
export function utcToLocalDateTime(moment: Date, timeZone: string): string {
  return new Date(clockMinutes(moment, timeZone) * MILLISECONDS_PER_MINUTE)
    .toISOString()
    .slice(0, 16);
}
