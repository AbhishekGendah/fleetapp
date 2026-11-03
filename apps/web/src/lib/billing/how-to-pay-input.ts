import { HOW_TO_PAY_MAX_LENGTH } from "@fleetapp/core";
import { z } from "zod";

/** Printed under every invoice, as typed: the business's own bank details for a transfer, say. */
export const howToPayInputSchema = z.object({
  howToPay: z
    .string()
    .trim()
    .max(HOW_TO_PAY_MAX_LENGTH, `Keep it to ${HOW_TO_PAY_MAX_LENGTH} characters.`),
});
export const HOW_TO_PAY_FIELDS = ["howToPay"] as const;
