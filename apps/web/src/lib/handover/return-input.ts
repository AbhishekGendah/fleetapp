import { needsReturnDate, REQUIRED_MESSAGE, utcToLocalDateTime } from "@fleetapp/core";
import { z } from "zod";

import { requiredLocalMoment } from "../local-moment-input";
import { vehicleStatusInputSchema, type VehicleStatusInput } from "../vehicles/vehicle-input";

/** The tick box sends this when ticked; nothing at all when not. */
export const TICKED = "on";
/** Where a returned car may go. Sold or written off are set on the car's own page. */
export const STATUSES_AFTER_RETURN = ["available", "in_service", "off_road"] as const;

export const RETURN_FORM_FIELDS = [
  "returnedAt",
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

export function returnFormSchema(timeZone: string): z.ZodType<ReturnFormInput, ReturnFormValues> {
  return z
    .object({
      returnedAt: requiredLocalMoment(timeZone),
      isRenterPresent: z.string().transform((value) => value === TICKED),
      status: z.enum(STATUSES_AFTER_RETURN, REQUIRED_MESSAGE),
      statusReason: z.string(),
      statusExpectedBack: z.string(),
    })
    .transform(({ returnedAt, isRenterPresent, ...carAfter }, context) => {
      const parsed = vehicleStatusInputSchema.safeParse(carAfter);
      if (!parsed.success) {
        parsed.error.issues.forEach((issue) => context.addIssue({ ...issue, code: "custom" }));
        return z.NEVER;
      }
      return { returnedAt, isRenterPresent, carAfter: parsed.data };
    });
}

export function isRequiredReturnField(field: ReturnFormField, values: ReturnFormValues): boolean {
  if (field === "statusReason" || field === "statusExpectedBack") {
    return needsReturnDate(values.status);
  }
  return field !== "isRenterPresent";
}

/** The form as it opens: back now, the Renter there, the car available again. */
export function initialReturnValues(now: Date, timeZone: string): ReturnFormValues {
  return {
    returnedAt: utcToLocalDateTime(now, timeZone),
    isRenterPresent: TICKED,
    status: "available",
    statusReason: "",
    statusExpectedBack: "",
  };
}
