import { isBlockRateChangeSignable } from "./rent-blocks";
import { canChangeEnd, type RentalChangeKind, type RentalChangeStatus } from "./rental-changes";
import type { RentalStatus } from "./rentals";

/**
 * When a contract or a change of terms can be sent and signed, written once
 * (review A3-15) and used by the rental's cards, the send actions, the
 * Renter's signing page and the final check inside the save.
 */

/** Until the car is handed over, the contract can still be sent and signed. */
const CONTRACT_SIGNING_STATUSES: readonly RentalStatus[] = ["draft", "booked"];

export function isContractSignable(rentalStatus: RentalStatus): boolean {
  return CONTRACT_SIGNING_STATUSES.includes(rentalStatus);
}

/** An end-date change and a made-ongoing change both set the rental's end: a later one replaces an earlier. */
const END_CHANGE_KINDS: readonly RentalChangeKind[] = ["end_date", "make_ongoing"];

export interface SignableChange {
  id: string;
  kind: RentalChangeKind;
  status: RentalChangeStatus;
  documentId: string | null;
  appliesFromBlock: number | null;
  createdAt: Date;
}

/** Why a change of terms can't be sent or signed now, or null when it can. */
export type ChangeSigningProblem =
  | "withdrawn"
  | "signed"
  | "rental_over"
  /** A rate change whose rent week has begun: never signed late (review A3-1). */
  | "out_of_time"
  /** An end change a later one replaced (review A3-12). */
  | "replaced";

export function changeSigningProblem(
  change: SignableChange,
  rental: { status: RentalStatus; handedOverAt: Date | null },
  otherChanges: readonly Pick<SignableChange, "id" | "kind" | "status" | "createdAt">[],
  now: Date,
): ChangeSigningProblem | null {
  if (change.status === "withdrawn") {
    return "withdrawn";
  }
  if (change.documentId !== null) {
    return "signed";
  }
  if (!canChangeEnd(rental.status)) {
    return "rental_over";
  }
  const isRateWeekBegun =
    change.status === "waiting_for_signature" &&
    change.appliesFromBlock !== null &&
    rental.handedOverAt !== null &&
    !isBlockRateChangeSignable(rental.handedOverAt, change.appliesFromBlock, now);
  if (isRateWeekBegun) {
    return "out_of_time";
  }
  const isReplaced =
    END_CHANGE_KINDS.includes(change.kind) &&
    otherChanges.some(
      (other) =>
        other.id !== change.id &&
        other.status !== "withdrawn" &&
        END_CHANGE_KINDS.includes(other.kind) &&
        other.createdAt.getTime() > change.createdAt.getTime(),
    );
  return isReplaced ? "replaced" : null;
}

/** A rate change still waiting after its week began: it can never be signed, so it stops blocking the next. */
export function isRateChangeOutOfTime(
  change: SignableChange,
  rental: { status: RentalStatus; handedOverAt: Date | null },
  now: Date,
): boolean {
  return changeSigningProblem(change, rental, [], now) === "out_of_time";
}

export const CHANGE_SIGNING_PROBLEM_LABELS: Readonly<Record<ChangeSigningProblem, string>> = {
  withdrawn: "Withdrawn",
  signed: "Signed",
  rental_over: "The rental is over",
  out_of_time: "Not signed in time",
  replaced: "Replaced by a later change",
};
