import { isRecordId, REQUIRED_MESSAGE } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { z } from "zod";

import type { PrivacyNoticeOutcome } from "../privacy/send-privacy-notice";
import { emptyRenterForm, parseRenterForm, type RenterInput } from "./renter-input";

/** Someone already in the Operator's Renters, or someone new (7 Nov 2026 mockups). */
export const DRIVER_SOURCES = ["existing", "new"] as const;
export type DriverSource = (typeof DRIVER_SOURCES)[number];

export const ADD_DRIVER_FIELDS = ["source", "driverId", "fullName", "phone", "email"] as const;
export type AddDriverField = (typeof ADD_DRIVER_FIELDS)[number];
export type AddDriverFormValues = Record<AddDriverField, string>;

const PICK_MESSAGE = "Pick who drives for it.";

/** A driver added whose privacy notice could not be emailed: the business hands it over (APP 5). */
export interface UnsentDriverNotice {
  driverName: string;
  outcome: Exclude<PrivacyNoticeOutcome, "sent">;
}

/** What adding a driver comes back with: the answer, and the notice still to give them. */
export type AddDriverState = ChangeFormState & { unsentNotice?: UnsentDriverNotice };

export type AddDriverInput =
  { source: "existing"; driverId: string } | { source: "new"; person: RenterInput };

/**
 * The Add a driver form, as typed and as the server checks it: a person
 * picked from the Operator's Renters, or someone new with a name and a phone
 * or email (the person form's own rules; they fill in the rest themselves
 * through their details link). `today` is the Operator's.
 */
function addDriverSchema(today: string) {
  return z
    .object({
      source: z.enum(DRIVER_SOURCES, REQUIRED_MESSAGE),
      driverId: z.string(),
      fullName: z.string(),
      phone: z.string(),
      email: z.string(),
    })
    .transform((input, context): AddDriverInput => {
      if (input.source === "existing") {
        if (!isRecordId(input.driverId)) {
          context.addIssue({ code: "custom", path: ["driverId"], message: PICK_MESSAGE });
          return z.NEVER;
        }
        return { source: "existing", driverId: input.driverId };
      }
      const person = parseRenterForm(
        { ...emptyRenterForm(), fullName: input.fullName, phone: input.phone, email: input.email },
        today,
      );
      if (!person.success) {
        for (const issue of person.error.issues) {
          context.addIssue({ code: "custom", path: issue.path, message: issue.message });
        }
        return z.NEVER;
      }
      return { source: "new", person: person.data };
    });
}

export function parseAddDriverForm(
  values: AddDriverFormValues,
  today: string,
): z.ZodSafeParseResult<AddDriverInput> {
  return addDriverSchema(today).safeParse(values);
}

export function emptyAddDriverForm(source: DriverSource): AddDriverFormValues {
  return { source, driverId: "", fullName: "", phone: "", email: "" };
}

/** For the asterisks: the pick, or the new person's name (phone and email are one or the other). */
export function isRequiredAddDriverField(
  field: AddDriverField,
  values: AddDriverFormValues,
): boolean {
  return values.source === "existing" ? field === "driverId" : field === "fullName";
}
