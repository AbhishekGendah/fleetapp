import { isRecordId, requiredText } from "@fleetapp/core";
import { z } from "zod";

const DRIVER_NEEDED_MESSAGE = "Choose who drives the car next.";

/** Starting a driver change (mockup 7, step 1): who drives next, and why. */
export const START_DRIVER_CHANGE_FIELDS = ["toDriverId", "reason"] as const;
export type StartDriverChangeFormValues = Record<
  (typeof START_DRIVER_CHANGE_FIELDS)[number],
  string
>;

export const startDriverChangeFormSchema = z.object({
  toDriverId: z.string().trim().refine(isRecordId, DRIVER_NEEDED_MESSAGE),
  reason: requiredText,
});

export type StartDriverChangeInput = z.infer<typeof startDriverChangeFormSchema>;

/** The tick that says the driver handing the car back is there to sign. */
export const OUTGOING_PRESENT = "on";
