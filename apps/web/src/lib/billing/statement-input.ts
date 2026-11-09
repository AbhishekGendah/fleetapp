import { z } from "zod";

import { requiredDate } from "../vehicles/amount-input";

/** The days a statement covers, both included: checked as typed and again on the server. */
export const statementRangeSchema = z
  .object({ fromDate: requiredDate, toDate: requiredDate })
  .refine((range) => range.fromDate <= range.toDate, {
    message: "The last day must be on or after the first.",
    path: ["toDate"],
  });
export type StatementRange = z.infer<typeof statementRangeSchema>;
export const STATEMENT_FIELDS = ["fromDate", "toDate"] as const;

/** The tick box sends this when ticked; nothing at all when not. */
const TICKED_VALUE = "on";

/** A business's statement across its cars: the days, and whether it goes to its contact by email. */
export const businessStatementSchema = z.intersection(
  statementRangeSchema,
  z.object({ isEmailed: z.string().transform((value) => value === TICKED_VALUE) }),
);
export type BusinessStatementRequest = z.infer<typeof businessStatementSchema>;
export const BUSINESS_STATEMENT_FIELDS = [...STATEMENT_FIELDS, "isEmailed"] as const;
export const BUSINESS_STATEMENT_TICKED = TICKED_VALUE;
