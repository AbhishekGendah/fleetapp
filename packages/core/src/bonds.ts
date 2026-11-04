import { addDays, todayInTimeZone } from "./calendar-dates";
/**
 * A rental's bond account (docs/design/06): a list of movements that is only
 * ever added to. What is held is always worked out from the list, never
 * stored (the ledger's rule 11, ahead of the ledger). Bonds carry no GST:
 * they are security, not payment, until used.
 */

/**
 * Money in (received), money out (refunded to the Renter, deducted for
 * charges), and a reversal, which undoes one earlier entry exactly: the way
 * a mistake is corrected, since no entry is ever changed or removed.
 */
export const BOND_MOVEMENT_KINDS = ["received", "refunded", "deducted", "reversal"] as const;
export type BondMovementKind = (typeof BOND_MOVEMENT_KINDS)[number];

/**
 * How money moved: a generic type (rule 16). Cash and bank transfers are
 * recorded by hand now; card and direct debit come with Stripe (Phase 4).
 */
export const PAYMENT_METHODS = ["cash", "bank_transfer", "card", "becs_debit"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The methods an Operator records by hand; the others are recorded by Stripe. */
export const MANUAL_PAYMENT_METHODS = [
  "bank_transfer",
  "cash",
] as const satisfies readonly PaymentMethod[];
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card: "Card",
  becs_debit: "Direct debit",
};

export const BOND_MOVEMENT_KIND_LABELS: Readonly<Record<BondMovementKind, string>> = {
  received: "Received",
  refunded: "Refunded",
  deducted: "Deducted",
  reversal: "Correction",
};

/** Kinds that need a payment method: money that moved between people. */
export const KINDS_WITH_METHOD: ReadonlySet<BondMovementKind> = new Set(["received", "refunded"]);

/** One entry as the bond's rules need it. Amounts are always positive cents. */
export interface BondMovementAmount {
  id: string;
  kind: BondMovementKind;
  amountCents: number;
  /** The entry a reversal undoes; null for every other kind. */
  reversesId: string | null;
  /**
   * Money that came in or went back through Stripe: put right only through
   * Stripe (a refund there), never by a correction here (review A5-3).
   */
  isFromStripe?: boolean;
}

const DIRECTIONS: Readonly<Record<Exclude<BondMovementKind, "reversal">, 1 | -1>> = {
  received: 1,
  refunded: -1,
  deducted: -1,
};

/**
 * How much an entry changes what is held: money in adds, money out takes
 * away, and a reversal takes back exactly what the entry it undoes did.
 * Null when a reversal's entry is not in the list.
 */
function heldChange(
  movement: BondMovementAmount,
  byId: ReadonlyMap<string, BondMovementAmount>,
): number | null {
  if (movement.kind !== "reversal") {
    return DIRECTIONS[movement.kind] * movement.amountCents;
  }
  const reversed = movement.reversesId ? byId.get(movement.reversesId) : undefined;
  if (!reversed || reversed.kind === "reversal") {
    return null;
  }
  return -DIRECTIONS[reversed.kind] * reversed.amountCents;
}

/**
 * The bond held now, in cents: everything received, less everything
 * refunded or deducted, with reversed entries cancelled out. Throws if a
 * reversal points at an entry that is missing or is itself a reversal:
 * the database refuses both, so that is a bug, not a state to show.
 */
export function bondHeldCents(movements: readonly BondMovementAmount[]): number {
  const byId = new Map(movements.map((movement) => [movement.id, movement]));
  return movements.reduce((held, movement) => {
    const change = heldChange(movement, byId);
    if (change === null) {
      throw new Error("A bond reversal must undo an entry of the same rental.");
    }
    return held + change;
  }, 0);
}

/** The entries that can still be corrected: not reversals, not from Stripe, and not already reversed. */
export function reversibleBondMovementIds(movements: readonly BondMovementAmount[]): Set<string> {
  const reversed = new Set(movements.map((movement) => movement.reversesId).filter(Boolean));
  return new Set(
    movements
      .filter(
        (movement) =>
          movement.kind !== "reversal" && !movement.isFromStripe && !reversed.has(movement.id),
      )
      .map((movement) => movement.id),
  );
}

/** How much of the bond is still to come: never below nothing, even when more was received. */
export function bondOwingCents(requiredCents: number, heldCents: number): number {
  return Math.max(requiredCents - heldCents, 0);
}

/** Whether the rental's rules want the bond in full before the car is handed over, and it is not. */
export function isBondShortForHandover(input: {
  isRequiredBeforeHandover: boolean;
  requiredCents: number;
  heldCents: number;
}): boolean {
  return input.isRequiredBeforeHandover && input.heldCents < input.requiredCents;
}

/**
 * The last day the bond is kept after the car came back, for late fines and
 * tolls (docs/design/04): the return day, on the business's calendar, plus
 * the hold days in the rental's own settings (rule 14).
 */
export function bondHeldUntil(returnedAt: Date, holdDays: number, timeZone: string): string {
  return addDays(todayInTimeZone(returnedAt, timeZone), holdDays);
}
