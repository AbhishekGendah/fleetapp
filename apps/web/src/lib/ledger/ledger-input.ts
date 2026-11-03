import {
  GST_TREATMENTS,
  isRecordId,
  REQUIRED_MESSAGE,
  requiredDollars,
  requiredLine,
} from "@fleetapp/core";
import { z } from "zod";

import { requiredDate } from "../vehicles/amount-input";

const ABOVE_ZERO_MESSAGE = "Enter more than $0.";
const TYPE_NEEDED_MESSAGE = "Choose what the charge is for.";

/** A one-off charge: what for, how much, what the Renter will read, and the day it counts from. */
export const chargeInputSchema = z.object({
  chargeTypeId: z.string().trim().refine(isRecordId, TYPE_NEEDED_MESSAGE),
  amountCents: requiredDollars.refine((cents) => cents > 0, ABOVE_ZERO_MESSAGE),
  description: requiredLine,
  effectiveOn: requiredDate,
});
export type ChargeInput = z.infer<typeof chargeInputSchema>;
export const CHARGE_FIELDS = ["chargeTypeId", "amountCents", "description", "effectiveOn"] as const;
export type ChargeField = (typeof CHARGE_FIELDS)[number];

/** What the charge form starts with: the type and amount passed in (e.g. from a damage record), today. */
export function chargeStart(
  preset: Partial<Record<ChargeField, string>>,
  today: string,
): Record<ChargeField, string> {
  return { chargeTypeId: "", amountCents: "", description: "", effectiveOn: today, ...preset };
}

/** Why a line is undone: the reversal's own description, read by the Renter. */
export const reversalInputSchema = z.object({ reason: requiredLine });
export type ReversalInput = z.infer<typeof reversalInputSchema>;
export const REVERSAL_FIELDS = ["reason"] as const;

/** One of the business's own charge types, or a built-in one's GST treatment. */
export const chargeTypeInputSchema = z.object({
  name: requiredLine,
  gstTreatment: z.enum(GST_TREATMENTS, REQUIRED_MESSAGE),
});
export type ChargeTypeInput = z.infer<typeof chargeTypeInputSchema>;
export const CHARGE_TYPE_FIELDS = ["name", "gstTreatment"] as const;

export const gstTreatmentInputSchema = chargeTypeInputSchema.pick({ gstTreatment: true });
export const GST_TREATMENT_FIELDS = ["gstTreatment"] as const;
