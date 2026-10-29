import { optionalLine, requiredEmail, requiredLine } from "@fleetapp/core";
import { z } from "zod";

export const createOperatorInputSchema = z.object({
  legalName: requiredLine,
  tradingName: optionalLine,
  userFullName: requiredLine,
  userEmail: requiredEmail,
});

export type CreateOperatorInput = z.infer<typeof createOperatorInputSchema>;
