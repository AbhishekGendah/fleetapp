import { isLocalDateTime, localDateTimeToUtc, REQUIRED_MESSAGE } from "@fleetapp/core";
import { z } from "zod";

const DATE_TIME_MESSAGE = "Enter the date and time.";
const SKIPPED_TIME_MESSAGE =
  "That time did not happen: the clocks went forward an hour. Check the time.";

/** A typed date-and-time on the Operator's clock, as the moment it names. */
function toMoment(timeZone: string) {
  return (typed: string, context: z.RefinementCtx): Date => {
    if (!isLocalDateTime(typed)) {
      context.addIssue({ code: "custom", message: DATE_TIME_MESSAGE });
      return z.NEVER;
    }
    const moment = localDateTimeToUtc(typed, timeZone);
    if (!moment) {
      context.addIssue({ code: "custom", message: SKIPPED_TIME_MESSAGE });
      return z.NEVER;
    }
    return moment;
  };
}

/** A moment typed on the Operator's clock and kept in UTC (rule 10). */
export function requiredLocalMoment(timeZone: string): z.ZodType<Date, string> {
  return z.string().trim().min(1, REQUIRED_MESSAGE).transform(toMoment(timeZone));
}

/** As `requiredLocalMoment`, but blank means none. */
export function optionalLocalMoment(timeZone: string): z.ZodType<Date | null, string> {
  return z
    .string()
    .trim()
    .transform((typed, context) => (typed === "" ? null : toMoment(timeZone)(typed, context)));
}
