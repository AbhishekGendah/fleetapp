/**
 * Damage on a car and the insurance claim for it (docs/design/05, damage
 * and incident records). Recovering money from the Renter is a Phase 4
 * charge; these records keep what it will charge from.
 */

export const DAMAGE_STATUSES = ["open", "repaired", "not_repairing"] as const;
export type DamageStatus = (typeof DAMAGE_STATUSES)[number];

export const DAMAGE_STATUS_LABELS: Readonly<Record<DamageStatus, string>> = {
  open: "Open",
  repaired: "Repaired",
  not_repairing: "Not repairing",
};

/** Not repairing needs a note saying why, so the record explains itself later. */
export function needsDamageNote(status: DamageStatus): boolean {
  return status === "not_repairing";
}

export const CLAIM_STATUSES = [
  "not_lodged",
  "lodged",
  "approved",
  "declined",
  "paid",
  "withdrawn",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Readonly<Record<ClaimStatus, string>> = {
  not_lodged: "Not lodged",
  lodged: "Lodged",
  approved: "Approved",
  declined: "Declined",
  paid: "Paid",
  withdrawn: "Withdrawn",
};

/** With the insurer and not finished: these are the claims to chase. */
export const CLAIM_STATUSES_UNDER_WAY: readonly ClaimStatus[] = ["lodged", "approved"];

/** Lodged or later: the insurer has it, so it has a claim number and a lodged date. */
export function isClaimLodged(status: ClaimStatus): boolean {
  return status !== "not_lodged";
}

/** Settled one way or another: a settled date is due. */
export function isClaimSettled(status: ClaimStatus): boolean {
  return status === "paid" || status === "declined" || status === "withdrawn";
}
