import {
  isLocalDateTime,
  localDateTimeToUtc,
  repeatedTimeMoments,
  REQUIRED_MESSAGE,
  type RepeatedTimeChoice,
} from "@fleetapp/core";
import { z } from "zod";

const DATE_TIME_MESSAGE = "Enter the date and time.";
// No amount: on Lord Howe Island the clocks move half an hour (review A11-9).
const SKIPPED_TIME_MESSAGE = "That time did not happen: the clocks went forward. Check the time.";
export const REPEATED_TIME_MESSAGE =
  "That time happened twice, as the clocks went back. Choose which one below.";

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

/**
 * A typed time that may fall in the hour the clocks go back: there the
 * Operator says which of the two was meant, never a silent guess (review
 * A11-9). Otherwise as `requiredLocalMoment`. Issues go on `typedField`, or on
 * `choiceField` when the choice is what is missing.
 */
export function momentWithRepeatChoice(
  typed: { value: string; choice: "" | RepeatedTimeChoice },
  timeZone: string,
  context: z.RefinementCtx,
  fields: { typedField: string; choiceField: string },
): Date | typeof z.NEVER {
  if (typed.value.trim() === "") {
    context.addIssue({ code: "custom", message: REQUIRED_MESSAGE, path: [fields.typedField] });
    return z.NEVER;
  }
  const repeated = repeatedTimeMoments(typed.value.trim(), timeZone);
  if (!repeated) {
    const parsed = requiredLocalMoment(timeZone).safeParse(typed.value);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) =>
        context.addIssue({ code: "custom", message: issue.message, path: [fields.typedField] }),
      );
      return z.NEVER;
    }
    return parsed.data;
  }
  if (typed.choice === "") {
    context.addIssue({
      code: "custom",
      message: REPEATED_TIME_MESSAGE,
      path: [fields.choiceField],
    });
    return z.NEVER;
  }
  return repeated[typed.choice];
}
