import {
  MAXIMUM_EXPIRY_WARNING_DAYS,
  MINIMUM_EXPIRY_WARNING_DAYS,
  REQUIRED_MESSAGE,
} from "@fleetapp/core";
import { z } from "zod";

const WARNING_DAYS_MESSAGE = `Enter a number of days from ${MINIMUM_EXPIRY_WARNING_DAYS} to ${MAXIMUM_EXPIRY_WARNING_DAYS}.`;

/** The settings that say how early "Due soon" shows, one per kind of expiry. */
export const WARNING_DAYS_SETTINGS = [
  "vehicleExpiryWarningDays",
  "licenceExpiryWarningDays",
] as const;
export type WarningDaysSetting = (typeof WARNING_DAYS_SETTINGS)[number];

export function isWarningDaysSetting(value: string): value is WarningDaysSetting {
  return (WARNING_DAYS_SETTINGS as readonly string[]).includes(value);
}

/** One "Due soon" setting's box, as typed. */
export const warningDaysInputSchema = z.object({
  days: z
    .string()
    .trim()
    .min(1, REQUIRED_MESSAGE)
    .regex(/^\d+$/, WARNING_DAYS_MESSAGE)
    .transform(Number)
    .refine(
      (days) => days >= MINIMUM_EXPIRY_WARNING_DAYS && days <= MAXIMUM_EXPIRY_WARNING_DAYS,
      WARNING_DAYS_MESSAGE,
    ),
});

export const WARNING_DAYS_FIELDS = ["days"] as const;
