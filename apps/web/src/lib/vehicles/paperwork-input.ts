import {
  AUSTRALIAN_STATE_CODES,
  blankAsMissing,
  centsForEditing,
  emptyForm,
  INSURANCE_COVER_TYPES,
  isCalendarDate,
  isPossibleGst,
  optionalDollars,
  REGO_TERMS_MONTHS,
  REQUIRED_MESSAGE,
  requiredDollars,
  requiredLine,
} from "@fleetapp/core";
import { z } from "zod";

const DATE_MESSAGE = "Enter a date.";
const GST_TOO_HIGH_MESSAGE = "GST cannot be more than a tenth of the GST-inclusive amount.";

const requiredDate = z
  .string()
  .trim()
  .min(1, REQUIRED_MESSAGE)
  .refine(isCalendarDate, DATE_MESSAGE);

const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === "" || isCalendarDate(value), DATE_MESSAGE)
  .transform((value) => (value === "" ? null : value));

/** Blank GST means none: the amount did not include GST. */
const gstDollars = optionalDollars.transform((cents) => cents ?? 0);

/** Every amount with GST: GST never more than the tenth inside the amount (rule 9). */
function refineGst(input: { costCents: number; gstCents: number }, context: z.RefinementCtx): void {
  if (!isPossibleGst(input.costCents, input.gstCents)) {
    context.addIssue({ code: "custom", path: ["gstCents"], message: GST_TOO_HIGH_MESSAGE });
  }
}

const REGO_TERM_TEXTS = REGO_TERMS_MONTHS.map(String) as [string, ...string[]];

/** One rego renewal as entered on a car's Paperwork tab. */
export const regoInputSchema = z
  .object({
    state: z.enum(AUSTRALIAN_STATE_CODES, REQUIRED_MESSAGE),
    termMonths: z.enum(REGO_TERM_TEXTS, REQUIRED_MESSAGE).transform(Number),
    expiresOn: requiredDate,
    paidOn: optionalDate,
    costCents: requiredDollars,
    gstCents: gstDollars,
  })
  .superRefine(refineGst);

export type RegoInput = z.infer<typeof regoInputSchema>;
export const REGO_FORM_FIELDS = [
  "state",
  "termMonths",
  "expiresOn",
  "paidOn",
  "costCents",
  "gstCents",
] as const;
export type RegoFormField = (typeof REGO_FORM_FIELDS)[number];
export type RegoFormValues = Record<RegoFormField, string>;

/** An insurance policy as entered when adding or editing one. */
export const policyInputSchema = z
  .object({
    insurer: requiredLine,
    policyNumber: requiredLine,
    coverType: z.enum(INSURANCE_COVER_TYPES, REQUIRED_MESSAGE),
    startsOn: requiredDate,
    endsOn: requiredDate,
    excessCents: optionalDollars,
    costCents: requiredDollars,
    gstCents: gstDollars,
  })
  .superRefine((input, context) => {
    refineGst(input, context);
    if (input.endsOn <= input.startsOn) {
      context.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "The policy must end after it starts.",
      });
    }
  });

export type PolicyInput = z.infer<typeof policyInputSchema>;
export const POLICY_FORM_FIELDS = [
  "insurer",
  "policyNumber",
  "coverType",
  "startsOn",
  "endsOn",
  "excessCents",
  "costCents",
  "gstCents",
] as const;
export type PolicyFormField = (typeof POLICY_FORM_FIELDS)[number];
export type PolicyFormValues = Record<PolicyFormField, string>;

const OPTIONAL_PAPERWORK_FIELDS: readonly string[] = ["paidOn", "excessCents", "gstCents"];

export function isRequiredPaperworkField(field: string): boolean {
  return !OPTIONAL_PAPERWORK_FIELDS.includes(field);
}

export function parseRegoForm(values: RegoFormValues): z.ZodSafeParseResult<RegoInput> {
  return regoInputSchema.safeParse(blankAsMissing(values, ["state", "termMonths"]));
}

export function parsePolicyForm(values: PolicyFormValues): z.ZodSafeParseResult<PolicyInput> {
  return policyInputSchema.safeParse(blankAsMissing(values, ["coverType"]));
}

export function emptyRegoForm(): RegoFormValues {
  return emptyForm(REGO_FORM_FIELDS);
}

export function emptyPolicyForm(): PolicyFormValues {
  return emptyForm(POLICY_FORM_FIELDS);
}

/** A saved policy as the edit form's boxes show it. */
export function policyFormValues(policy: PolicyInput): PolicyFormValues {
  return {
    insurer: policy.insurer,
    policyNumber: policy.policyNumber,
    coverType: policy.coverType,
    startsOn: policy.startsOn,
    endsOn: policy.endsOn,
    excessCents: policy.excessCents === null ? "" : centsForEditing(policy.excessCents),
    costCents: centsForEditing(policy.costCents),
    gstCents: policy.gstCents === 0 ? "" : centsForEditing(policy.gstCents),
  };
}
