import { ledgerBalanceCents, type DatedLedgerLine, type Overdue } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray } from "drizzle-orm";

import { selectLinesByRental } from "../ledger/rental-balances";
import { renterOverdueOf } from "./renter-list-status";

export interface RenterMoney {
  /** What they owe across all their rentals; negative when in credit. */
  balanceCents: number;
  /** Their longest-late rental's overdue money, if any is past its grace days. */
  overdue: Overdue | null;
  /** How many of their rentals the balance adds up: those with a line on them. */
  rentalCount: number;
}

/**
 * What each of these Renters owes, added up from their rentals' ledger lines
 * by the one ledger rule (rule 11, the same as their Money tab), and whether
 * any of those rentals is overdue (each worked out from its own lines, as
 * Needs attention does). Two queries for a whole page of Renters, inside the
 * Operator's tenant context (rules 1 and 2). A Renter with no lines at all is
 * left out, so a list can tell "nothing charged yet" from "all paid up".
 */
export async function loadRenterMoney(
  database: AnyDatabase,
  operatorId: string,
  renterIds: readonly string[],
  overdueRule: { today: string; graceDays: number },
): Promise<Map<string, RenterMoney>> {
  if (renterIds.length === 0) {
    return new Map();
  }
  const ofTheseRenters = inArray(rentals.renterId, [...renterIds]);
  const [linesByRental, renterOfRental] = await withTenant(database, operatorId, async (tx) => [
    await selectLinesByRental(tx, operatorId, ofTheseRenters),
    await tx
      .select({ rentalId: rentals.id, renterId: rentals.renterId })
      .from(rentals)
      .where(and(eq(rentals.operatorId, operatorId), ofTheseRenters)),
  ]);
  const linesByRenter = new Map<string, (DatedLedgerLine & { rentalId: string })[]>();
  for (const { rentalId, renterId } of renterOfRental) {
    const lines = (linesByRental.get(rentalId) ?? []).map((line) => ({ ...line, rentalId }));
    if (lines.length > 0) {
      linesByRenter.set(renterId, [...(linesByRenter.get(renterId) ?? []), ...lines]);
    }
  }
  return new Map(
    [...linesByRenter].map(([renterId, lines]): [string, RenterMoney] => [
      renterId,
      {
        balanceCents: ledgerBalanceCents(lines),
        overdue: renterOverdueOf(lines, overdueRule.today, overdueRule.graceDays),
        rentalCount: new Set(lines.map((line) => line.rentalId)).size,
      },
    ]),
  );
}
