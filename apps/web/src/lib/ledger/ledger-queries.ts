import {
  BUILT_IN_CHARGE_TYPE_LABELS,
  ledgerBalanceCents,
  owingCharges,
  reversibleLineIds,
  type GstTreatment,
  type LedgerLineKind,
  type PaymentMethod,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  billingDocumentLines,
  billingDocuments,
  chargeTypes,
  ledgerLines,
  possessions,
  rentals,
  vehicles,
} from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";

export interface LedgerLineView {
  id: string;
  rentalId: string;
  /** The car the Renter had for this line: after a swap, not always the rental's car now (review G4-3). */
  rego: string;
  /**
   * Who drove that car then, by the same rule (for a person, themselves):
   * named on a business's documents beside the rego.
   */
  driverId: string | null;
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
  /**
   * Rent and its corrections: the first day they cover, or for block rent
   * the exact start of the period (as an ISO moment), so documents can match
   * a correction to its period's invoice.
   */
  periodStart: string | null;
  /** A correction to a block period already charged. */
  isCorrection: boolean;
  /** The charge type's GST treatment now, for marking a line with no GST on a tax invoice. */
  gstTreatment: GstTreatment | null;
  /** The invoice, credit note or receipt the line is on, if any. */
  documentId: string | null;
  /** That document's number as printed, e.g. "INV-1001". */
  documentNumberText: string | null;
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

/** The car a possession of this rental was of, its rego. */
const POSSESSED_REGO = sql`select ${qualified(vehicles.rego)} from ${possessions}
  join ${vehicles} on ${qualified(vehicles.id)} = ${qualified(possessions.vehicleId)}
    and ${qualified(vehicles.operatorId)} = ${qualified(possessions.operatorId)}
  where ${qualified(possessions.rentalId)} = ${qualified(ledgerLines.rentalId)}
    and ${qualified(possessions.operatorId)} = ${qualified(ledgerLines.operatorId)}`;

/** Who had the car in a possession of this rental: its driver. */
const POSSESSED_DRIVER = sql`select ${qualified(possessions.driverId)} from ${possessions}
  where ${qualified(possessions.rentalId)} = ${qualified(ledgerLines.rentalId)}
    and ${qualified(possessions.operatorId)} = ${qualified(ledgerLines.operatorId)}`;

/**
 * What a possession of the line's rental says about the line: from the one
 * the Renter had when its period began (or when it was entered), else the
 * first they had, else the rental's own. Display only: no amount depends on it.
 */
function fromLinePossession<Value>(possessed: SQL, ofRental: SQL): SQL<Value> {
  return sql<Value>`coalesce(
  (${possessed}
    and ${qualified(possessions.startedAt)} <= coalesce(${qualified(ledgerLines.periodStartsAt)}, ${qualified(ledgerLines.periodStart)}::timestamptz, ${qualified(ledgerLines.createdAt)})
    order by ${qualified(possessions.startedAt)} desc limit 1),
  (${possessed} order by ${qualified(possessions.startedAt)} asc limit 1),
  ${ofRental}
)`;
}

/** Which car a line was for. */
const lineRego = fromLinePossession<string>(POSSESSED_REGO, qualified(vehicles.rego));
/** Who drove the car a line was for; none while a business's driver is still to be named. */
const lineDriverId = fromLinePossession<string | null>(
  POSSESSED_DRIVER,
  qualified(rentals.driverId),
);

async function selectLedgerLines(
  tx: AnyTransaction,
  operatorId: string,
  where: SQL | undefined,
): Promise<LedgerLineView[]> {
  const rows = await tx
    .select({
      line: ledgerLines,
      rego: lineRego,
      driverId: lineDriverId,
      builtIn: chargeTypes.builtIn,
      typeName: chargeTypes.name,
      gstTreatment: chargeTypes.gstTreatment,
      documentId: billingDocuments.id,
      documentNumberText: billingDocuments.numberText,
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
    .leftJoin(
      billingDocumentLines,
      and(
        eq(billingDocumentLines.ledgerLineId, ledgerLines.id),
        eq(billingDocumentLines.operatorId, ledgerLines.operatorId),
      ),
    )
    .leftJoin(
      billingDocuments,
      and(
        eq(billingDocuments.id, billingDocumentLines.billingDocumentId),
        eq(billingDocuments.operatorId, billingDocumentLines.operatorId),
      ),
    )
    .where(and(eq(ledgerLines.operatorId, operatorId), where))
    .orderBy(asc(ledgerLines.effectiveOn), asc(ledgerLines.createdAt));
  return rows.map(({ line, rego, driverId, builtIn, typeName, ...billing }) => ({
    id: line.id,
    rentalId: line.rentalId,
    rego,
    driverId,
    kind: line.kind,
    chargeTypeLabel: builtIn ? BUILT_IN_CHARGE_TYPE_LABELS[builtIn] : typeName,
    amountCents: line.amountCents,
    gstCents: line.gstCents,
    description: line.description,
    effectiveOn: line.effectiveOn,
    method: line.method,
    reference: line.reference,
    reversesId: line.reversesId,
    periodStart: line.periodStart ?? line.periodStartsAt?.toISOString() ?? null,
    isCorrection: line.isCorrection,
    gstTreatment: billing.gstTreatment,
    documentId: billing.documentId,
    documentNumberText: billing.documentNumberText,
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
    ledgerViewOf(await selectRenterLedger(tx, operatorId, renterId)),
  );
}

/** Every line of every rental the Renter pays for, in one read, inside the caller's transaction. */
export function selectRenterLedger(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<LedgerLineView[]> {
  return selectLedgerLines(tx, operatorId, eq(rentals.renterId, renterId));
}

/** The lines that charge for one piece of damage (and their reversals' targets), to show beside it. */
export async function loadDamageCharges(
  database: AnyDatabase,
  operatorId: string,
  damageRecordId: string,
): Promise<LedgerView> {
  return withTenant(database, operatorId, async (tx) =>
    ledgerViewOf(
      await selectLedgerLines(tx, operatorId, eq(ledgerLines.damageRecordId, damageRecordId)),
    ),
  );
}
