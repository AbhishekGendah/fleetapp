import {
  CLAIM_STATUS_LABELS,
  CLAIM_STATUSES,
  DAMAGE_STATUS_LABELS,
  DAMAGE_STATUSES,
  formatCalendarDate,
  formatCents,
  type ClaimStatus,
  type DamageStatus,
} from "@fleetapp/core";

import type { ClaimFormField, FoundDamageFormValues } from "./damage-input";

type FoundDamageField = keyof FoundDamageFormValues;

/** The damage form's box names, as the Operator reads them. */
export const FOUND_DAMAGE_LABELS: Readonly<Record<FoundDamageField, string>> = {
  foundOn: "Found on",
  description: "What is damaged",
  x: "Where on the car",
  y: "Where on the car",
  rentalId: "Who had the car",
};

export const DAMAGE_STATUS_FIELD_LABELS = {
  status: "Status",
  statusNote: "Note",
} as const;

/** The claim form's box names. */
export const CLAIM_LABELS: Readonly<Record<ClaimFormField, string>> = {
  policyId: "Policy",
  insurer: "Insurer",
  claimNumber: "Claim number",
  status: "Claim status",
  excessCents: "Excess",
  lodgedOn: "Lodged on",
  settledOn: "Settled on",
  payoutCents: "Paid out",
  notes: "Notes",
};

const LOG_FIELD_LABELS: Readonly<Record<string, string>> = {
  foundOn: "Found on",
  status: "Status",
  rentalId: "Rental",
  fromReturn: "From the return",
  damageRecordId: "Damage record",
  excessCents: "Excess",
  payoutCents: "Paid out",
};

/** How the damage and claim Log names a field. */
export function damageFieldLabel(field: string): string {
  return LOG_FIELD_LABELS[field] ?? field;
}

const isDamageStatus = (value: unknown): value is DamageStatus =>
  DAMAGE_STATUSES.some((status) => status === value);
const isClaimStatus = (value: unknown): value is ClaimStatus =>
  CLAIM_STATUSES.some((status) => status === value);

/** A damage or claim value in words for the Log; record ids are not shown. */
export function describeDamageValue(field: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "None";
  }
  if (field === "status" && isDamageStatus(value)) {
    return DAMAGE_STATUS_LABELS[value];
  }
  if (field === "status" && isClaimStatus(value)) {
    return CLAIM_STATUS_LABELS[value];
  }
  if ((field === "excessCents" || field === "payoutCents") && typeof value === "number") {
    return formatCents(value);
  }
  if (field === "foundOn" && typeof value === "string") {
    return formatCalendarDate(value);
  }
  if (field === "rentalId" || field === "damageRecordId") {
    return "Set";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}
