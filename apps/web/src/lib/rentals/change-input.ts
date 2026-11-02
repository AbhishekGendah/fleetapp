import { emptyForm, requiredDollars, requiredLine } from "@fleetapp/core";
import { z } from "zod";

import { requiredLocalMoment } from "../local-moment-input";
import { requiredDate } from "../vehicles/amount-input";

const TOO_SOON_MESSAGE = "A new rate can start tomorrow at the earliest.";
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

export const RATE_CHANGE_FIELDS = ["weeklyRateCents", "appliesFrom", "reason"] as const;
export type RateChangeFormValues = Record<(typeof RATE_CHANGE_FIELDS)[number], string>;
export interface RateChangeInput {
  weeklyRateCents: number;
  appliesFrom: string;
  reason: string;
}

/** A new rate in whole cents (rule 9), from `earliestDay` (tomorrow) on. */
export function rateChangeFormSchema(
  earliestDay: string,
): z.ZodType<RateChangeInput, RateChangeFormValues> {
  return z.object({
    weeklyRateCents: requiredDollars.refine((cents) => cents > 0, RATE_NEEDED_MESSAGE),
    appliesFrom: requiredDate.refine((day) => day >= earliestDay, TOO_SOON_MESSAGE),
    reason: requiredLine,
  });
}

export function emptyRateChangeForm(earliestDay: string): RateChangeFormValues {
  return { ...emptyForm(RATE_CHANGE_FIELDS), appliesFrom: earliestDay };
}
