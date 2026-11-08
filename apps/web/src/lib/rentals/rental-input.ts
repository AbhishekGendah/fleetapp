import {
  centsForEditing,
  emptyForm,
  isRecordId,
  optionalDollars,
  optionalText,
  RENTAL_TYPES,
  REQUIRED_MESSAGE,
  requiredDollars,
  requiredLine,
  type RentalType,
} from "@fleetapp/core";
import { z } from "zod";

import { optionalLocalMoment, requiredLocalMoment } from "../local-moment-input";

const PICK_RENTER_MESSAGE = "Choose a Renter.";
const PICK_CAR_MESSAGE = "Choose a car.";
const END_NEEDED_MESSAGE = "Enter when the rental ends, or choose Ongoing.";
const END_AFTER_START_MESSAGE = "The end must be after the start.";
const DAILY_RATE_MESSAGE = "Enter the daily rate.";
const WEEKLY_PRICE_ABOVE_ZERO_MESSAGE = "Enter a weekly price above $0, or leave it empty.";

const recordIdOf = (message: string) => z.string().trim().refine(isRecordId, message);

/** The driver picker's choice for a business's booking with its driver still to be named (decision 2). */
export const DRIVER_TO_BE_NAMED = "to_be_named";

/**
 * A business's driver as picked: one of its drivers, or none yet. Anything
 * else (a person's own rental sends nothing) reads as none: who may drive is
 * checked against the business's own drivers when it is saved.
 */
export const pickedDriverId = z
  .string()
  .trim()
  .transform((value) => (isRecordId(value) ? value : null));

/**
 * A new rental, as on the New rental form. Times are typed on the
 * Operator's clock (`timeZone`) and kept in UTC. An ongoing rental has no
 * end: whatever the end box holds is dropped.
 */
function rentalInputSchemaIn(timeZone: string) {
  return z
    .object({
      renterId: recordIdOf(PICK_RENTER_MESSAGE),
      driverId: pickedDriverId,
      vehicleId: recordIdOf(PICK_CAR_MESSAGE),
      type: z.enum(RENTAL_TYPES, REQUIRED_MESSAGE),
      plannedStart: requiredLocalMoment(timeZone),
      plannedEnd: optionalLocalMoment(timeZone),
      dailyRateCents: requiredDollars.refine((cents) => cents > 0, DAILY_RATE_MESSAGE),
      longTermWeeklyCents: optionalDollars.refine(
        (cents) => cents === null || cents > 0,
        WEEKLY_PRICE_ABOVE_ZERO_MESSAGE,
      ),
      bondCents: requiredDollars,
      notes: optionalText,
    })
    .transform((input) => ({
      ...input,
      plannedEnd: input.type === "ongoing" ? null : input.plannedEnd,
    }))
    .superRefine((input, context) => {
      if (input.type !== "fixed_term") {
        return;
      }
      if (input.plannedEnd === null) {
        context.addIssue({ code: "custom", path: ["plannedEnd"], message: END_NEEDED_MESSAGE });
      } else if (input.plannedEnd.getTime() <= input.plannedStart.getTime()) {
        context.addIssue({
          code: "custom",
          path: ["plannedEnd"],
          message: END_AFTER_START_MESSAGE,
        });
      }
    });
}

export type RentalInput = z.infer<ReturnType<typeof rentalInputSchemaIn>>;

export const RENTAL_FORM_FIELDS = [
  "renterId",
  "driverId",
  "vehicleId",
  "type",
  "plannedStart",
  "plannedEnd",
  "dailyRateCents",
  "longTermWeeklyCents",
  "bondCents",
  "notes",
] as const;
export type RentalFormField = (typeof RENTAL_FORM_FIELDS)[number];
export type RentalFormValues = Record<RentalFormField, string>;

/** Which boxes carry the red asterisk: the end only while the rental is fixed-term. */
export function isRequiredRentalField(field: RentalFormField, type: string): boolean {
  if (field === "plannedEnd") {
    return type === "fixed_term";
  }
  return field !== "notes" && field !== "longTermWeeklyCents" && field !== "driverId";
}

export function parseRentalForm(
  values: RentalFormValues,
  timeZone: string,
): z.ZodSafeParseResult<RentalInput> {
  return rentalInputSchemaIn(timeZone).safeParse(values);
}

/** A blank form, with the Renter or car (and its prices) filled in when opened from their page. */
export function emptyRentalForm(
  preset: Partial<
    Pick<
      RentalFormValues,
      "renterId" | "vehicleId" | "plannedStart" | "dailyRateCents" | "longTermWeeklyCents"
    >
  > = {},
): RentalFormValues {
  const type: RentalType = "fixed_term";
  return { ...emptyForm(RENTAL_FORM_FIELDS), type, driverId: DRIVER_TO_BE_NAMED, ...preset };
}

/** Naming a business's driver on a draft or booking, or putting it back to "to be named". */
export const nameDriverInputSchema = z.object({ driverId: pickedDriverId });
export type NameDriverInput = z.infer<typeof nameDriverInputSchema>;

/** Why a booking was cancelled: kept with the rental, never shown in the log. */
export const cancelRentalInputSchema = z.object({ reason: requiredLine });
export type CancelRentalInput = z.infer<typeof cancelRentalInputSchema>;

/** A car's prices as the booking form fills them in: daily rate and long-term weekly price. */
export interface CarPrices {
  dailyRateCents: number | null;
  longTermWeeklyCents: number | null;
}

/**
 * The booking form's price boxes for a car: both always set, empty where the
 * car has no price, so a price from a car picked before never stays behind.
 */
export function carPriceFields(
  prices: CarPrices | undefined,
): Pick<RentalFormValues, "dailyRateCents" | "longTermWeeklyCents"> {
  const shown = (cents: number | null | undefined) => (cents ? centsForEditing(cents) : "");
  return {
    dailyRateCents: shown(prices?.dailyRateCents),
    longTermWeeklyCents: shown(prices?.longTermWeeklyCents),
  };
}
