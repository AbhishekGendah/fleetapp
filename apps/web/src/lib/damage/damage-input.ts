import {
  CLAIM_STATUSES,
  DAMAGE_STATUSES,
  emptyForm,
  isClaimLodged,
  isClaimSettled,
  isRecordId,
  needsDamageNote,
  optionalDollars,
  optionalLine,
  optionalText,
  REQUIRED_MESSAGE,
  requiredLine,
} from "@fleetapp/core";
import { z } from "zod";

import { optionalDate, requiredDate } from "../vehicles/amount-input";

const FUTURE_MESSAGE = "It cannot have been found in the future.";
const NOTE_NEEDED = "Say why it is not being repaired.";
const POSITION_MESSAGE = "Tap the outline, or choose the area, or leave both blank.";

/** Blank, or one of the business's records. */
const optionalRecordId = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .refine((value) => value === null || isRecordId(value), REQUIRED_MESSAGE);

/** A place on the car outline as the form sends it: whole numbers, both or neither. */
const outlinePlace = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value === null || (Number.isInteger(value) && value >= 0), POSITION_MESSAGE);

export const FOUND_DAMAGE_FIELDS = ["foundOn", "description", "x", "y", "rentalId"] as const;
export type FoundDamageFormValues = Record<(typeof FOUND_DAMAGE_FIELDS)[number], string>;
export interface FoundDamageInput {
  foundOn: string;
  description: string;
  x: number | null;
  y: number | null;
  rentalId: string | null;
}

/**
 * Damage found away from a checklist: when (the business's today at the
 * latest), what, where on the car, and who had it, as confirmed by the
 * Operator from the suggestion.
 */
export function foundDamageFormSchema(
  today: string,
): z.ZodType<FoundDamageInput, FoundDamageFormValues> {
  return z
    .object({
      foundOn: requiredDate.refine((date) => date <= today, FUTURE_MESSAGE),
      description: requiredLine,
      x: outlinePlace,
      y: outlinePlace,
      rentalId: optionalRecordId,
    })
    .refine((input) => (input.x === null) === (input.y === null), {
      path: ["x"],
      message: POSITION_MESSAGE,
    });
}

/** Open, repaired, or not repairing with a reason. */
export const damageStatusFormSchema = z
  .object({
    status: z.enum(DAMAGE_STATUSES, REQUIRED_MESSAGE),
    statusNote: optionalLine,
  })
  .superRefine((input, context) => {
    if (needsDamageNote(input.status) && !input.statusNote) {
      context.addIssue({ code: "custom", path: ["statusNote"], message: NOTE_NEEDED });
    }
  });
export type DamageStatusInput = z.infer<typeof damageStatusFormSchema>;
export const DAMAGE_STATUS_FIELDS = ["status", "statusNote"] as const;

/**
 * The insurance claim, as far as it has gone: lodged needs the claim
 * number and date; settled (paid, declined, withdrawn) a settled date on or
 * after lodging; paid the amount paid out. Amounts in whole cents (rule 9).
 */
export const claimFormSchema = z
  .object({
    policyId: optionalRecordId,
    insurer: requiredLine,
    claimNumber: optionalLine.transform((value) => value?.toUpperCase() ?? null),
    status: z.enum(CLAIM_STATUSES, REQUIRED_MESSAGE),
    excessCents: optionalDollars,
    lodgedOn: optionalDate,
    settledOn: optionalDate,
    payoutCents: optionalDollars,
    notes: optionalText,
  })
  .superRefine((input, context) => {
    const need = (path: string, isMissing: boolean, message: string) => {
      if (isMissing) {
        context.addIssue({ code: "custom", path: [path], message });
      }
    };
    const isLodged = isClaimLodged(input.status);
    need("claimNumber", isLodged && !input.claimNumber, "Enter the insurer's claim number.");
    need("lodgedOn", isLodged && !input.lodgedOn, "Enter the day it was lodged.");
    need(
      "settledOn",
      isClaimSettled(input.status) && !input.settledOn,
      "Enter the day it was settled.",
    );
    need(
      "payoutCents",
      input.status === "paid" && input.payoutCents === null,
      "Enter the amount paid out.",
    );
    need(
      "settledOn",
      Boolean(input.lodgedOn && input.settledOn && input.settledOn < input.lodgedOn),
      "It cannot be settled before it was lodged.",
    );
  });
export type ClaimInput = z.infer<typeof claimFormSchema>;
export const CLAIM_FORM_FIELDS = [
  "policyId",
  "insurer",
  "claimNumber",
  "status",
  "excessCents",
  "lodgedOn",
  "settledOn",
  "payoutCents",
  "notes",
] as const;
export type ClaimFormField = (typeof CLAIM_FORM_FIELDS)[number];
export type ClaimFormValues = Record<ClaimFormField, string>;

export function emptyFoundDamageForm(today: string): FoundDamageFormValues {
  return { ...emptyForm(FOUND_DAMAGE_FIELDS), foundOn: today };
}

/** Which claim boxes carry the asterisk, as the claim gets further. */
export function isRequiredClaimField(field: ClaimFormField, values: ClaimFormValues): boolean {
  const status = CLAIM_STATUSES.find((option) => option === values.status) ?? "not_lodged";
  switch (field) {
    case "insurer":
    case "status":
      return true;
    case "claimNumber":
    case "lodgedOn":
      return isClaimLodged(status);
    case "settledOn":
      return isClaimSettled(status);
    case "payoutCents":
      return status === "paid";
    default:
      return false;
  }
}
