import {
  MAXIMUM_DOCUMENT_NUMBER,
  NUMBER_PREFIX_MAX_LENGTH,
  NUMBER_PREFIX_PATTERN,
  REQUIRED_MESSAGE,
} from "@fleetapp/core";
import { z } from "zod";

const PREFIX_MESSAGE = `Use up to ${NUMBER_PREFIX_MAX_LENGTH} capital letters, digits, dashes, dots or slashes.`;
const NUMBER_MESSAGE = `Enter a whole number from 1 to ${MAXIMUM_DOCUMENT_NUMBER.toLocaleString("en-AU")}.`;

/**
 * A series' prefix and next number. The prefix is put in capitals on the
 * server too (rule 31); an empty prefix prints the number alone.
 */
export const numberingInputSchema = z.object({
  prefix: z
    .string()
    .trim()
    .transform((prefix) => prefix.toUpperCase())
    .pipe(
      z
        .string()
        .max(NUMBER_PREFIX_MAX_LENGTH, PREFIX_MESSAGE)
        .regex(NUMBER_PREFIX_PATTERN, PREFIX_MESSAGE),
    ),
  nextNumber: z
    .string(REQUIRED_MESSAGE)
    .trim()
    .min(1, REQUIRED_MESSAGE)
    .transform((digits) => Number(digits.replaceAll(",", "")))
    .pipe(
      z
        .number()
        .int(NUMBER_MESSAGE)
        .min(1, NUMBER_MESSAGE)
        .max(MAXIMUM_DOCUMENT_NUMBER, NUMBER_MESSAGE),
    ),
});
export type NumberingInput = z.output<typeof numberingInputSchema>;
export const NUMBERING_FIELDS = ["prefix", "nextNumber"] as const;
