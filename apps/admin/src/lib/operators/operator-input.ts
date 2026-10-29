import { optionalLine, requiredEmail, requiredLine } from "@fleetapp/core";
import { z } from "zod";

export const createOperatorInputSchema = z.object({
  legalName: requiredLine,
  tradingName: optionalLine,
  userFullName: requiredLine,
  userEmail: requiredEmail,
});

export type CreateOperatorInput = z.infer<typeof createOperatorInputSchema>;

/** The form's boxes, by name, in the order they appear. */
export const CREATE_OPERATOR_FIELDS = [
  "legalName",
  "tradingName",
  "userFullName",
  "userEmail",
] as const satisfies readonly (keyof CreateOperatorInput)[];

export type CreateOperatorField = (typeof CREATE_OPERATOR_FIELDS)[number];

const OPTIONAL_CREATE_OPERATOR_FIELDS: readonly CreateOperatorField[] = ["tradingName"];

export function isRequiredCreateOperatorField(field: CreateOperatorField): boolean {
  return !OPTIONAL_CREATE_OPERATOR_FIELDS.includes(field);
}
