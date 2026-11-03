import {
  BUILT_IN_CHARGE_TYPE_LABELS,
  ledgerBalanceCents,
  owingCharges,
  reversibleLineIds,
  type LedgerLineKind,
  type PaymentMethod,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { chargeTypes, ledgerLines, rentals, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, type SQL } from "drizzle-orm";

export interface LedgerLineView {
  id: string;
  rentalId: string;
  rego: string;
  kind: LedgerLineKind;
  /** What a charge or credit was for, e.g. "Weekly rent". */
  chargeTypeLabel: string | null;
  amountCents: number;
  gstCents: number;
  description: string;
  effectiveOn: string;
  method: PaymentMethod | null;
  reference: string | null;
  reversesId: string | null;
  createdAt: Date;
}

export interface LedgerView {
  lines: LedgerLineView[];
  /** Owed by the Renter; negative when they are in credit. */
  balanceCents: number;
  /** The oldest day still owing, for how long it has been owed. */
  oldestOwingOn: string | null;
  reversibleIds: Set<string>;
}

async function selectLedgerLines(
  tx: AnyTransaction,
  operatorId: string,
  where: SQL | undefined,
): Promise<LedgerLineView[]> {
  const rows = await tx
    .select({
      line: ledgerLines,
      rego: vehicles.rego,
      builtIn: chargeTypes.builtIn,
      typeName: chargeTypes.name,
    })
    .from(ledgerLines)
    .innerJoin(
      rentals,
      and(eq(rentals.id, ledgerLines.rentalId), eq(rentals.operatorId, ledgerLines.operatorId)),
    )
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, rentals.vehicleId), eq(vehicles.operatorId, rentals.operatorId)),
    )
    .leftJoin(
      chargeTypes,
      and(
        eq(chargeTypes.id, ledgerLines.chargeTypeId),
        eq(chargeTypes.operatorId, ledgerLines.operatorId),
      ),
    )
    .where(and(eq(ledgerLines.operatorId, operatorId), where))
    .orderBy(asc(ledgerLines.effectiveOn), asc(ledgerLines.createdAt));
  return rows.map(({ line, rego, builtIn, typeName }) => ({
    id: line.id,
    rentalId: line.rentalId,
    rego,
    kind: line.kind,
    chargeTypeLabel: builtIn ? BUILT_IN_CHARGE_TYPE_LABELS[builtIn] : typeName,
    amountCents: line.amountCents,
    gstCents: line.gstCents,
    description: line.description,
    effectiveOn: line.effectiveOn,
    method: line.method,
    reference: line.reference,
    reversesId: line.reversesId,
    createdAt: line.createdAt,
  }));
}

/** A ledger with its balance, always added up from the lines (rule 11). */
export function ledgerViewOf(lines: LedgerLineView[]): LedgerView {
  return {
    lines,
    balanceCents: ledgerBalanceCents(lines),
    oldestOwingOn: owingCharges(lines)[0]?.effectiveOn ?? null,
    reversibleIds: reversibleLineIds(lines),
  };
}

/** One rental's lines and balance. */
export async function loadRentalLedger(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<LedgerView> {
  return withTenant(database, operatorId, async (tx) =>
    ledgerViewOf(await selectLedgerLines(tx, operatorId, eq(ledgerLines.rentalId, rentalId))),
  );
}

export function selectRentalLedger(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<LedgerLineView[]> {
  return selectLedgerLines(tx, operatorId, eq(ledgerLines.rentalId, rentalId));
}

/** A Renter's whole ledger: every line of every rental of theirs. */
export async function loadRenterLedger(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
): Promise<LedgerView> {
  return withTenant(database, operatorId, async (tx) =>
    ledgerViewOf(await selectLedgerLines(tx, operatorId, eq(rentals.renterId, renterId))),
  );
}
