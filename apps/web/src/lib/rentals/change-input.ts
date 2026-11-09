import { emptyForm, RATE_RISE_NOTICE_DAYS, requiredDollars, requiredLine } from "@fleetapp/core";
import { z } from "zod";

import { requiredLocalMoment } from "../local-moment-input";

const RATE_NEEDED_MESSAGE = "Enter the new weekly rate.";

/**
 * The change-of-terms forms, as the browser and the server check them
 * (rule 28). Times are typed on the business's clock (rule 10); the
 * server's own rules (core) then check the new end against the rental.
 */

export const END_CHANGE_FIELDS = ["newEnd", "reason"] as const;
export type EndChangeFormValues = Record<(typeof END_CHANGE_FIELDS)[number], string>;
export interface EndChangeInput {
  newEnd: Date;
  reason: string;
}

export function endChangeFormSchema(
  timeZone: string,
): z.ZodType<EndChangeInput, EndChangeFormValues> {
  return z.object({ newEnd: requiredLocalMoment(timeZone), reason: requiredLine });
}

export const ONGOING_CHANGE_FIELDS = ["reason"] as const;
export const ongoingChangeFormSchema = z.object({ reason: requiredLine });

export const RATE_CHANGE_FIELDS = ["weeklyRateCents", "fromBlock", "reason"] as const;
export type RateChangeFormValues = Record<(typeof RATE_CHANGE_FIELDS)[number], string>;
export interface RateChangeInput {
  weeklyRateCents: number;
  fromBlock: number;
  reason: string;
}

const WEEK_START_MESSAGE = "Choose the rent week the new rate starts with.";

/**
 * A new weekly price in whole cents (rule 9), from one of the rent weeks
 * offered (`weekStarts`, each a week's first block), never mid-week.
 */
/**
 * For a Renter paying by direct debit, a rise starts no sooner than the
 * first rent week 30 days ahead (slice 5 decision 3); a fall any week.
 */
export interface RateRiseNotice {
  fromBlock: number;
  /** The weekly rate now, that a rise is measured against. */
  currentWeeklyCents: number;
  /** That first week, in words, for the message. */
  fromLabel: string;
}

export function rateChangeFormSchema(
  weekStarts: readonly number[],
  notice: RateRiseNotice | null = null,
): z.ZodType<RateChangeInput, RateChangeFormValues> {
  return z
    .object({
      weeklyRateCents: requiredDollars.refine((cents) => cents > 0, RATE_NEEDED_MESSAGE),
      fromBlock: z
        .string()
        .trim()
        .transform(Number)
        .refine((block) => weekStarts.includes(block), WEEK_START_MESSAGE),
      reason: requiredLine,
    })
    .superRefine((value, context) => {
      const isTooSoon =
        notice !== null &&
        value.weeklyRateCents > notice.currentWeeklyCents &&
        value.fromBlock < notice.fromBlock;
      if (isTooSoon) {
        context.addIssue({
          code: "custom",
          path: ["fromBlock"],
          message: `A rise needs ${RATE_RISE_NOTICE_DAYS} days' notice: choose the week from ${notice.fromLabel} or later.`,
        });
      }
    });
}

export function emptyRateChangeForm(firstWeekStart: number | undefined): RateChangeFormValues {
  return {
    ...emptyForm(RATE_CHANGE_FIELDS),
    fromBlock: firstWeekStart === undefined ? "" : String(firstWeekStart),
  };
}
