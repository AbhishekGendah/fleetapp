import {
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

/**
 * A new rental, as on the New rental form. Times are typed on the
 * Operator's clock (`timeZone`) and kept in UTC. An ongoing rental has no
 * end: whatever the end box holds is dropped.
 */
function rentalInputSchemaIn(timeZone: string) {
  return z
    .object({
      renterId: recordIdOf(PICK_RENTER_MESSAGE),
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
  return field !== "notes" && field !== "longTermWeeklyCents";
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
  return { ...emptyForm(RENTAL_FORM_FIELDS), type, ...preset };
}

/** Why a booking was cancelled: kept with the rental, never shown in the log. */
export const cancelRentalInputSchema = z.object({ reason: requiredLine });
export type CancelRentalInput = z.infer<typeof cancelRentalInputSchema>;
