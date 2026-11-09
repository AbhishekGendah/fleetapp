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
  /**
   * A rate change whose rent week has begun (review A3-1), or whose start
   * (moved by the notice) reaches a later rate already signed: never signed.
   */
  | "out_of_time"
  /** An end change a later one replaced (review A3-12). */
  | "replaced";

export function changeSigningProblem(
  change: SignableChange,
  rental: {
    status: RentalStatus;
    handedOverAt: Date | null;
    /**
     * A rise for a Renter paying by direct debit: signed late, it starts at
     * the first rent week 30 days on instead (slice 5 decision 3), so its
     * week having begun never stops it.
     */
    isStartMovedBySigning?: boolean;
    /** The rent week (block) it would start with if signed now: moved by the notice, or as proposed. */
    startBlock?: number | null;
    /** The first rate already signed after its proposed start, if any. */
    nextRateBlock?: number | null;
  },
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
    rental.isStartMovedBySigning !== true &&
    change.status === "waiting_for_signature" &&
    change.appliesFromBlock !== null &&
    rental.handedOverAt !== null &&
    !isBlockRateChangeSignable(rental.handedOverAt, change.appliesFromBlock, now);
  // Starting on or after a later signed rate would clash with it or override it: never signed.
  const startBlock = rental.startBlock ?? change.appliesFromBlock;
  const isPastLaterRate =
    change.status === "waiting_for_signature" &&
    startBlock !== null &&
    rental.nextRateBlock !== null &&
    rental.nextRateBlock !== undefined &&
    startBlock >= rental.nextRateBlock;
  if (isRateWeekBegun || isPastLaterRate) {
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
