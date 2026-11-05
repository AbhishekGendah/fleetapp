import {
  needsReturnDate,
  REPEATED_TIME_CHOICES,
  repeatedTimeChoiceOf,
  REQUIRED_MESSAGE,
  utcToLocalDateTime,
} from "@fleetapp/core";
import { z } from "zod";

import { momentWithRepeatChoice } from "../local-moment-input";
import { vehicleStatusInputSchema, type VehicleStatusInput } from "../vehicles/vehicle-input";

/** The tick box sends this when ticked; nothing at all when not. */
export const TICKED = "on";
/** Where a returned car may go. Sold or written off are set on the car's own page. */
export const STATUSES_AFTER_RETURN = ["available", "in_service", "off_road"] as const;

export const RETURN_FORM_FIELDS = [
  "returnedAt",
  /** Which of a time shown twice, when the clocks go back (review A11-9). */
  "repeatedTime",
  "isRenterPresent",
  "status",
  "statusReason",
  "statusExpectedBack",
] as const;
export type ReturnFormField = (typeof RETURN_FORM_FIELDS)[number];
export type ReturnFormValues = Record<ReturnFormField, string>;

/**
 * The return's last step, as the form and the server check it (rule 28):
 * when the car came back (typed on the Operator's clock), whether the
 * Renter is there to sign, and where the car goes next.
 */
export interface ReturnFormInput {
  returnedAt: Date;
  isRenterPresent: boolean;
  carAfter: VehicleStatusInput;
}

/** Where a car goes once it is back (a return or a swap): the status boxes, as typed. */
export function carAfterFields(statuses: readonly [string, ...string[]]): {
  status: z.ZodEnum<Record<string, string>>;
  statusReason: z.ZodString;
  statusExpectedBack: z.ZodString;
} {
  return {
    status: z.enum(statuses, REQUIRED_MESSAGE),
    statusReason: z.string(),
    statusExpectedBack: z.string(),
  };
}

/** Those boxes checked as a car status (a reason and date for the workshop), or the problems added. */
export function parseCarAfter(
  carAfter: { status: string; statusReason: string; statusExpectedBack: string },
  context: z.RefinementCtx,
): VehicleStatusInput | typeof z.NEVER {
  const parsed = vehicleStatusInputSchema.safeParse(carAfter);
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => context.addIssue({ ...issue, code: "custom" }));
    return z.NEVER;
  }
  return parsed.data;
}

export function returnFormSchema(timeZone: string): z.ZodType<ReturnFormInput, ReturnFormValues> {
  return z
    .object({
      returnedAt: z.string(),
      repeatedTime: z.enum(["", ...REPEATED_TIME_CHOICES]),
      isRenterPresent: z.string().transform((value) => value === TICKED),
      ...carAfterFields(STATUSES_AFTER_RETURN),
    })
    .transform(({ returnedAt, repeatedTime, isRenterPresent, ...carAfter }, context) => ({
      returnedAt: momentWithRepeatChoice(
        { value: returnedAt, choice: repeatedTime },
        timeZone,
        context,
        { typedField: "returnedAt", choiceField: "repeatedTime" },
      ),
      isRenterPresent,
      carAfter: parseCarAfter(carAfter, context),
    }));
}

export function isRequiredReturnField(field: ReturnFormField, values: ReturnFormValues): boolean {
  if (field === "statusReason" || field === "statusExpectedBack") {
    return needsReturnDate(values.status);
  }
  // Asked, and so required, only for a time the clock shows twice.
  return field !== "isRenterPresent";
}

/** The form as it opens: back now, the Renter there, the car available again. */
export function initialReturnValues(now: Date, timeZone: string): ReturnFormValues {
  return {
    returnedAt: utcToLocalDateTime(now, timeZone),
    // Now, exactly: in the hour that repeats, the one it is (review A11-9).
    repeatedTime: repeatedTimeChoiceOf(now, timeZone) ?? "",
    isRenterPresent: TICKED,
    status: "available",
    statusReason: "",
    statusExpectedBack: "",
  };
}
