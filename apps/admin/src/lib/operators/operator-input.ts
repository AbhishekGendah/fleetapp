import { z } from "zod";

const MAXIMUM_NAME_LENGTH = 200;

/**
 * Names end up in email subject lines, where a line break would let someone
 * add headers of their own. Refused here rather than escaped later.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const singleLineText = z
  .string()
  .trim()
  .max(MAXIMUM_NAME_LENGTH, `At most ${MAXIMUM_NAME_LENGTH} characters.`)
  .refine((value) => !CONTROL_CHARACTERS.test(value), "Must be on one line.");

const requiredName = singleLineText.min(1, "Required.");

export const createOperatorInputSchema = z.object({
  legalName: requiredName,
  tradingName: singleLineText.optional().transform((value) => (value ? value : null)),
  userFullName: requiredName,
  userEmail: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
});

export type CreateOperatorInput = z.infer<typeof createOperatorInputSchema>;
