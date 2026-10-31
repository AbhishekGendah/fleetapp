import {
  MAXIMUM_EXPIRY_WARNING_DAYS,
  MAXIMUM_RENTER_LINK_DAYS,
  MINIMUM_EXPIRY_WARNING_DAYS,
  MINIMUM_RENTER_LINK_DAYS,
  REQUIRED_MESSAGE,
} from "@fleetapp/core";
import { z } from "zod";

/** The settings that are a number of days, each with its own range. */
const DAYS_SETTING_RANGES = {
  /** How early "Due soon" shows for rego and insurance. */
  vehicleExpiryWarningDays: { min: MINIMUM_EXPIRY_WARNING_DAYS, max: MAXIMUM_EXPIRY_WARNING_DAYS },
  /** How early "Due soon" shows for a licence. */
  licenceExpiryWarningDays: { min: MINIMUM_EXPIRY_WARNING_DAYS, max: MAXIMUM_EXPIRY_WARNING_DAYS },
  /** How long a Renter's details form link works. */
  renterLinkValidDays: { min: MINIMUM_RENTER_LINK_DAYS, max: MAXIMUM_RENTER_LINK_DAYS },
} as const;

export type DaysSetting = keyof typeof DAYS_SETTING_RANGES;
/** The "Due soon" windows, which the expiry badges read. */
export type WarningDaysSetting = Exclude<DaysSetting, "renterLinkValidDays">;

export function isDaysSetting(value: string): value is DaysSetting {
  return Object.hasOwn(DAYS_SETTING_RANGES, value);
}

/** One days setting's box, as typed, checked against that setting's range. */
export function daysInputSchema(
  setting: DaysSetting,
): z.ZodType<{ days: number }, { days: string }> {
  const { min, max } = DAYS_SETTING_RANGES[setting];
  const message = `Enter a number of days from ${min} to ${max}.`;
  return z.object({
    days: z
      .string()
      .trim()
      .min(1, REQUIRED_MESSAGE)
      .regex(/^\d+$/, message)
      .transform(Number)
      .refine((days) => days >= min && days <= max, message),
  });
}

export const DAYS_FIELDS = ["days"] as const;
