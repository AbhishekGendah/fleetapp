import { ledgerBalanceCents, type LedgerLineAmount } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { ledgerLines } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray } from "drizzle-orm";

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
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: ledgerLines.id,
        rentalId: ledgerLines.rentalId,
        kind: ledgerLines.kind,
        amountCents: ledgerLines.amountCents,
        reversesId: ledgerLines.reversesId,
      })
      .from(ledgerLines)
      .where(
        and(eq(ledgerLines.operatorId, operatorId), inArray(ledgerLines.rentalId, [...rentalIds])),
      ),
  );
  const linesByRental = new Map<string, LedgerLineAmount[]>();
  for (const row of rows) {
    linesByRental.set(row.rentalId, [...(linesByRental.get(row.rentalId) ?? []), row]);
  }
  return new Map(
    [...linesByRental].map(([rentalId, lines]): [string, number] => [
      rentalId,
      ledgerBalanceCents(lines),
    ]),
  );
}
