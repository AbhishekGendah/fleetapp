import {
  MAXIMUM_BOND_HOLD_DAYS,
  MAXIMUM_EXPIRY_WARNING_DAYS,
  MAXIMUM_MINIMUM_RENTER_AGE_YEARS,
  MAXIMUM_ONGOING_NOTICE_DAYS,
  MINIMUM_DRIVER_AGE_YEARS,
  MAXIMUM_LICENCE_SCAN_KEPT_MONTHS,
  MAXIMUM_RENTER_LINK_DAYS,
  MINIMUM_EXPIRY_WARNING_DAYS,
  MINIMUM_LICENCE_SCAN_KEPT_MONTHS,
  MINIMUM_RENTER_LINK_DAYS,
  REQUIRED_MESSAGE,
  MAXIMUM_GRACE_MINUTES,
  MAXIMUM_LONG_TERM_MINIMUM_DAYS,
  MAXIMUM_PAYMENT_GRACE_DAYS,
  MAXIMUM_ONE_OFF_NOTICE_DAYS,
  MINIMUM_ONE_OFF_NOTICE_DAYS,
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
  /** The youngest a Renter may be when the rental starts. */
  minimumRenterAgeYears: {
    min: MINIMUM_DRIVER_AGE_YEARS,
    max: MAXIMUM_MINIMUM_RENTER_AGE_YEARS,
    unit: "years",
  },
  /** How long the bond is kept after the car comes back. */
  bondHoldDaysAfterReturn: { min: 0, max: MAXIMUM_BOND_HOLD_DAYS, unit: "days" },
  /** Minutes past a whole 24-hour block that are free at the return. */
  graceMinutes: { min: 0, max: MAXIMUM_GRACE_MINUTES, unit: "minutes" },
  /** Booked for at least this many days, a rental is long-term. */
  longTermMinimumDays: { min: 1, max: MAXIMUM_LONG_TERM_MINIMUM_DAYS, unit: "days" },
  /** The notice a Renter on an ongoing rental gives before returning the car. */
  ongoingNoticeDays: { min: 0, max: MAXIMUM_ONGOING_NOTICE_DAYS, unit: "days" },
  /** Grace days: money still owing this many days after it was due counts as overdue. */
  paymentGraceDays: { min: 0, max: MAXIMUM_PAYMENT_GRACE_DAYS, unit: "days" },
  /** Notice before a one-off charge is debited, from the day its invoice is emailed. */
  oneOffNoticeDays: {
    min: MINIMUM_ONE_OFF_NOTICE_DAYS,
    max: MAXIMUM_ONE_OFF_NOTICE_DAYS,
    unit: "days",
  },
} as const;

export type NumberSetting = keyof typeof NUMBER_SETTING_RANGES;
/** The "Due soon" windows, which the expiry badges read. */
export type WarningDaysSetting = "vehicleExpiryWarningDays" | "licenceExpiryWarningDays";

/** How many digits the setting's box takes: no more than its largest value has (rule 31). */
export function numberSettingDigits(setting: NumberSetting): number {
  return String(NUMBER_SETTING_RANGES[setting].max).length;
}

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
