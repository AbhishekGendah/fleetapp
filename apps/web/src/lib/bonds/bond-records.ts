import { type ManualPaymentMethod } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  bondMovements,
  rentals,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { ROW_LOCK } from "@fleetapp/db/row-lock";
import { and, eq } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { findOpenBondCheckout } from "../payments/stripe-checkouts";
import {
  BOND_OPEN_STATUSES,
  bondAccountIn,
  bondAccountOf,
  selectBondMovements,
  type BondAccount,
} from "./bond-account";
import type { BondReceivedInput, BondReversalInput } from "./bond-input";

export type BondReceivedResult =
  | {
      status: "saved";
      account: BondAccount;
      /**
       * The Stripe bond page still open when this was recorded, read under
       * the rental's lock: Stripe's news of it waits for that lock, so this
       * is the page to stop, and to ask Stripe whether it was paid as well.
       */
      openBondPageId: string | null;
    }
  | { status: "more_than_owing"; owingCents: number }
  | { status: "on_its_way"; onItsWayCents: number; toReceiveByHandCents: number }
  | { status: "not_found" | "not_open" };

export type BondReversalResult =
  | { status: "saved"; account: BondAccount }
  | { status: "not_found" | "not_reversible" | "would_go_below_nothing" };

/** A rental as its bond's entries need it. */
export interface BondRental {
  id: string;
  renterId: string;
  status: string;
  bondCents: number;
}

/**
 * The rental, locked so two entries made at once cannot both pass the
 * checks against the same balance; null if it is not this Operator's.
 * Stripe's news about the bond takes it too, before anything else ("Lock
 * order"), so an entry by hand and one from Stripe go one after the other.
 */
export async function lockBondRental(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<BondRental | null> {
  const [rental] = await tx
    .select({
      id: rentals.id,
      renterId: rentals.renterId,
      status: rentals.status,
      bondCents: rentals.bondCents,
    })
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)))
    .for(ROW_LOCK);
  return rental ?? null;
}

function logBondMovement(
  tx: AnyTransaction,
  actor: ActingUser,
  movement: { id: string; kind: string; amountCents: number; method: ManualPaymentMethod | null },
): Promise<void> {
  // Amount, kind and method only: references and reasons stay with the bond (rule 7).
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.bondMovement,
    entityId: movement.id,
    action: ACTIVITY_ACTIONS.created,
    valuesAfter: {
      kind: movement.kind,
      amountCents: movement.amountCents,
      method: movement.method,
    },
  });
}

/**
 * Records bond received by hand. Refused for a closed or cancelled rental,
 * and when it is more than the rest of the bond: an overpayment is money
 * owed back, which the ledger handles (Phase 4), not the bond.
 */
export async function recordBondReceived(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  input: BondReceivedInput,
): Promise<BondReceivedResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const rental = await lockBondRental(tx, actor.operatorId, rentalId);
    if (!rental) {
      return { status: "not_found" as const };
    }
    if (!BOND_OPEN_STATUSES.has(rental.status)) {
      return { status: "not_open" as const };
    }
    const before = await bondAccountIn(tx, actor.operatorId, rental);
    if (input.amountCents > before.owingCents) {
      return { status: "more_than_owing" as const, owingCents: before.owingCents };
    }
    if (input.amountCents > before.toReceiveByHandCents) {
      // A bank debit for it is still clearing: taking it again would hold it twice (review A5-2).
      return {
        status: "on_its_way" as const,
        onItsWayCents: before.onItsWayCents,
        toReceiveByHandCents: before.toReceiveByHandCents,
      };
    }
    const [movement] = await tx
      .insert(bondMovements)
      .values({
        operatorId: actor.operatorId,
        rentalId,
        kind: "received",
        amountCents: input.amountCents,
        method: input.method,
        reference: input.reference,
        occurredOn: input.occurredOn,
        createdByUserId: actor.userId,
      })
      .returning({ id: bondMovements.id });
    await logBondMovement(tx, actor, {
      id: movement!.id,
      kind: "received",
      amountCents: input.amountCents,
      method: input.method,
    });
    const [movements, openBondPage] = await Promise.all([
      selectBondMovements(tx, actor.operatorId, rentalId),
      findOpenBondCheckout(tx, actor.operatorId, rentalId),
    ]);
    return {
      status: "saved" as const,
      account: bondAccountOf(movements, rental.bondCents),
      openBondPageId: openBondPage?.sessionId ?? null,
    };
  });
}

/**
 * Corrects an entry the only way the bond allows (rule 11): a reversal that
 * undoes it exactly, dated today, with the reason. Each entry once; never a
 * reversal of a reversal; never leaving less than nothing held.
 */
export async function reverseBondMovement(
  database: AnyDatabase,
  actor: ActingUser,
  target: { rentalId: string; movementId: string },
  input: BondReversalInput,
  today: string,
): Promise<BondReversalResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const rental = await lockBondRental(tx, actor.operatorId, target.rentalId);
    if (!rental) {
      return { status: "not_found" as const };
    }
    const movements = await selectBondMovements(tx, actor.operatorId, target.rentalId);
    const before = bondAccountOf(movements, rental.bondCents);
    const reversed = movements.find((movement) => movement.id === target.movementId);
    if (!reversed || !before.reversibleIds.has(reversed.id)) {
      return { status: reversed ? ("not_reversible" as const) : ("not_found" as const) };
    }
    if (reversed.kind === "received" && reversed.amountCents > before.heldCents) {
      return { status: "would_go_below_nothing" as const };
    }
    const [movement] = await tx
      .insert(bondMovements)
      .values({
        operatorId: actor.operatorId,
        rentalId: target.rentalId,
        kind: "reversal",
        amountCents: reversed.amountCents,
        occurredOn: today,
        note: input.note,
        reversesId: reversed.id,
        createdByUserId: actor.userId,
      })
      .returning({ id: bondMovements.id });
    await logBondMovement(tx, actor, {
      id: movement!.id,
      kind: "reversal",
      amountCents: reversed.amountCents,
      method: null,
    });
    const after = await selectBondMovements(tx, actor.operatorId, target.rentalId);
    return { status: "saved" as const, account: bondAccountOf(after, rental.bondCents) };
  });
}
