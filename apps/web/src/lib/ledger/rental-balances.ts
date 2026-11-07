import { ledgerBalanceCents, type DatedLedgerLine } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ledgerLines, rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, type SQL } from "drizzle-orm";

/**
 * Each rental's own ledger lines, for every rental of the Operator's that
 * `rentalWhere` picks, in one query. A rental with no lines at all is left
 * out. Every figure made from them is added up by the one ledger rule
 * (rule 11).
 */
export async function selectLinesByRental(
  tx: AnyTransaction,
  operatorId: string,
  rentalWhere: SQL | undefined,
): Promise<Map<string, DatedLedgerLine[]>> {
  const rows = await tx
    .select({
      id: ledgerLines.id,
      rentalId: ledgerLines.rentalId,
      kind: ledgerLines.kind,
      amountCents: ledgerLines.amountCents,
      reversesId: ledgerLines.reversesId,
      effectiveOn: ledgerLines.effectiveOn,
    })
    .from(ledgerLines)
    .innerJoin(
      rentals,
      and(eq(rentals.id, ledgerLines.rentalId), eq(rentals.operatorId, ledgerLines.operatorId)),
    )
    .where(and(eq(ledgerLines.operatorId, operatorId), rentalWhere));
  const linesByRental = new Map<string, DatedLedgerLine[]>();
  for (const { rentalId, ...line } of rows) {
    // Added to in place: copying the list for every line grows with the square of a rental's lines.
    const lines = linesByRental.get(rentalId);
    if (lines) {
      lines.push(line);
    } else {
      linesByRental.set(rentalId, [line]);
    }
  }
  return linesByRental;
}

/**
 * What each of these rentals' Renters owes (negative when in credit), added
 * up from each rental's own lines by the one ledger rule (rule 11). One query
 * for a whole page of rentals. A rental with no lines at all is left out, so
 * a list can tell "nothing charged yet" from "all paid up".
 */
export async function loadRentalBalances(
  database: AnyDatabase,
  operatorId: string,
  rentalIds: readonly string[],
): Promise<Map<string, number>> {
  if (rentalIds.length === 0) {
    return new Map();
  }
  const linesByRental = await withTenant(database, operatorId, (tx) =>
    selectLinesByRental(tx, operatorId, inArray(rentals.id, [...rentalIds])),
  );
  return new Map(
    [...linesByRental].map(([rentalId, lines]): [string, number] => [
      rentalId,
      ledgerBalanceCents(lines),
    ]),
  );
}
