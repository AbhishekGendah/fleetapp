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
