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
import { and, asc, eq } from "drizzle-orm";

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
  createdAt: Date;
}

/** A rental's bond: every entry, oldest first, what is held and still owing, and what can be corrected. */
export interface BondAccount {
  movements: BondMovementRow[];
  heldCents: number;
  owingCents: number;
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
      createdAt: bondMovements.createdAt,
    })
    .from(bondMovements)
    .where(and(eq(bondMovements.operatorId, operatorId), eq(bondMovements.rentalId, rentalId)))
    .orderBy(asc(bondMovements.occurredOn), asc(bondMovements.createdAt));
}

/** Works out what is held and owing from the entries (rule 11's approach): never stored. */
export function bondAccountOf(movements: BondMovementRow[], requiredCents: number): BondAccount {
  const heldCents = bondHeldCents(movements);
  return {
    movements,
    heldCents,
    owingCents: bondOwingCents(requiredCents, heldCents),
    reversibleIds: reversibleBondMovementIds(movements),
  };
}

export async function loadBondAccount(
  database: AnyDatabase,
  operatorId: string,
  rental: { id: string; bondCents: number },
): Promise<BondAccount> {
  const movements = await withTenant(database, operatorId, (tx) =>
    selectBondMovements(tx, operatorId, rental.id),
  );
  return bondAccountOf(movements, rental.bondCents);
}
