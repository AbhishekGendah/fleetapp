import {
  MAXIMUM_EXPIRY_WARNING_DAYS,
  MINIMUM_EXPIRY_WARNING_DAYS,
  REQUIRED_MESSAGE,
} from "@fleetapp/core";
import { z } from "zod";

const WARNING_DAYS_MESSAGE = `Enter a number of days from ${MINIMUM_EXPIRY_WARNING_DAYS} to ${MAXIMUM_EXPIRY_WARNING_DAYS}.`;

/** The Cars section of Settings, as typed. */
export const carSettingsInputSchema = z.object({
  vehicleExpiryWarningDays: z
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

export const CAR_SETTINGS_FIELDS = ["vehicleExpiryWarningDays"] as const;
