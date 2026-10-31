import {
  MAXIMUM_EXPIRY_WARNING_DAYS,
  MAXIMUM_LICENCE_SCAN_KEPT_MONTHS,
  MAXIMUM_RENTER_LINK_DAYS,
  MINIMUM_EXPIRY_WARNING_DAYS,
  MINIMUM_LICENCE_SCAN_KEPT_MONTHS,
  MINIMUM_RENTER_LINK_DAYS,
  REQUIRED_MESSAGE,
} from "@fleetapp/core";
import { z } from "zod";

/** The settings that are a whole number of days or months, each with its own range. */
const NUMBER_SETTING_RANGES = {
  /** How early "Due soon" shows for rego and insurance. */
  vehicleExpiryWarningDays: {
    min: MINIMUM_EXPIRY_WARNING_DAYS,
    max: MAXIMUM_EXPIRY_WARNING_DAYS,
    unit: "days",
  },
  /** How early "Due soon" shows for a licence. */
  licenceExpiryWarningDays: {
    min: MINIMUM_EXPIRY_WARNING_DAYS,
    max: MAXIMUM_EXPIRY_WARNING_DAYS,
    unit: "days",
  },
  /** How long a Renter's details form link works. */
  renterLinkValidDays: {
    min: MINIMUM_RENTER_LINK_DAYS,
    max: MAXIMUM_RENTER_LINK_DAYS,
    unit: "days",
  },
  /** How long licence scans are kept after the last rental, or after being added. */
  licenceScanKeptMonths: {
    min: MINIMUM_LICENCE_SCAN_KEPT_MONTHS,
    max: MAXIMUM_LICENCE_SCAN_KEPT_MONTHS,
    unit: "months",
  },
} as const;

export type NumberSetting = keyof typeof NUMBER_SETTING_RANGES;
/** The "Due soon" windows, which the expiry badges read. */
export type WarningDaysSetting = "vehicleExpiryWarningDays" | "licenceExpiryWarningDays";

export function isNumberSetting(value: string): value is NumberSetting {
  return Object.hasOwn(NUMBER_SETTING_RANGES, value);
}

/** One number setting's box, as typed: digits only, within that setting's range. */
export function numberSettingInputSchema(
  setting: NumberSetting,
): z.ZodType<{ amount: number }, { amount: string }> {
  const { min, max, unit } = NUMBER_SETTING_RANGES[setting];
  const message = `Enter a number of ${unit} from ${min} to ${max}.`;
  return z.object({
    amount: z
      .string()
      .trim()
      .min(1, REQUIRED_MESSAGE)
      .regex(/^\d+$/, message)
      .transform(Number)
      .refine((amount) => amount >= min && amount <= max, message),
  });
}

export const NUMBER_SETTING_FIELDS = ["amount"] as const;
