import {
  bondHeldCents,
  bondOwingCents,
  reversibleBondMovementIds,
  type BondMovementKind,
  type PaymentMethod,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { bondMovements } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, sql } from "drizzle-orm";

import { bondOnItsWayCents } from "./bond-on-its-way";

/** Bond can be taken until the rental is closed or cancelled. */
export const BOND_OPEN_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "booked",
  "active",
  "returned",
]);

/** One entry on a rental's bond account, as its page lists it. */
export interface BondMovementRow {
  id: string;
  kind: BondMovementKind;
  amountCents: number;
  method: PaymentMethod | null;
  reference: string | null;
  occurredOn: string;
  note: string | null;
  reversesId: string | null;
  /** It came in or went back through Stripe, so only Stripe can put it right (review A5-3). */
  isFromStripe: boolean;
  createdAt: Date;
}

/** A rental's bond: every entry, oldest first, what is held and still owing, and what can be corrected. */
export interface BondAccount {
  movements: BondMovementRow[];
  heldCents: number;
  owingCents: number;
  /** Paid through Stripe but not in yet (a bank debit clearing): never counted as held. */
  onItsWayCents: number;
  /** What can still be recorded by hand: owing, less what is on its way (review A5-2). */
  toReceiveByHandCents: number;
  reversibleIds: ReadonlySet<string>;
}

export async function selectBondMovements(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<BondMovementRow[]> {
  return tx
    .select({
      id: bondMovements.id,
      kind: bondMovements.kind,
      amountCents: bondMovements.amountCents,
      method: bondMovements.method,
      reference: bondMovements.reference,
      occurredOn: bondMovements.occurredOn,
      note: bondMovements.note,
      reversesId: bondMovements.reversesId,
      isFromStripe: sql<boolean>`(${bondMovements.paymentId} is not null or ${bondMovements.stripeObjectId} is not null)`,
      createdAt: bondMovements.createdAt,
    })
    .from(bondMovements)
    .where(and(eq(bondMovements.operatorId, operatorId), eq(bondMovements.rentalId, rentalId)))
    .orderBy(asc(bondMovements.occurredOn), asc(bondMovements.createdAt));
}

/** Works out what is held and owing from the entries (rule 11's approach): never stored. */
export function bondAccountOf(
  movements: BondMovementRow[],
  requiredCents: number,
  onItsWayCents = 0,
): BondAccount {
  const heldCents = bondHeldCents(movements);
  const owingCents = bondOwingCents(requiredCents, heldCents);
  return {
    movements,
    heldCents,
    owingCents,
    onItsWayCents,
    toReceiveByHandCents: Math.max(owingCents - onItsWayCents, 0),
    reversibleIds: reversibleBondMovementIds(movements),
  };
}

/** The rental's bond with what is on its way through Stripe, read in one transaction. */
export async function bondAccountIn(
  tx: AnyTransaction,
  operatorId: string,
  rental: { id: string; bondCents: number },
): Promise<BondAccount> {
  const [movements, onItsWayCents] = await Promise.all([
    selectBondMovements(tx, operatorId, rental.id),
    bondOnItsWayCents(tx, operatorId, rental.id),
  ]);
  return bondAccountOf(movements, rental.bondCents, onItsWayCents);
}

export async function loadBondAccount(
  database: AnyDatabase,
  operatorId: string,
  rental: { id: string; bondCents: number },
): Promise<BondAccount> {
  return withTenant(database, operatorId, (tx) => bondAccountIn(tx, operatorId, rental));
}
