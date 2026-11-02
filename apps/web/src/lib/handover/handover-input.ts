import { handoverDetailsInputSchema } from "@fleetapp/core";

import { requiredKilometres } from "../vehicles/vehicle-input";

/** The handover checklist's details as the form and the server check them (rule 28). */
export const handoverDetailsFormSchema = handoverDetailsInputSchema.extend({
  odometerKm: requiredKilometres,
});

export const HANDOVER_DETAIL_FIELDS = [
  "odometerKm",
  "fuelLevel",
  "keysCount",
  "accessories",
  "notes",
] as const;
export type HandoverDetailField = (typeof HANDOVER_DETAIL_FIELDS)[number];

export const REQUIRED_HANDOVER_DETAILS: ReadonlySet<HandoverDetailField> = new Set([
  "odometerKm",
  "fuelLevel",
  "keysCount",
]);
