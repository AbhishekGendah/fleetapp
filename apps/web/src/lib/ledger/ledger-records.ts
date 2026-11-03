import { gstForLine, isGstRegisteredOn, type RentalStatus } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  damageRecords,
  ledgerLines,
  rentals,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import type { ManualPaymentInput } from "../money/manual-payment-input";
import { usableChargeType } from "./charge-types";
import type { ChargeInput, ReversalInput } from "./ledger-input";
import { ledgerViewOf, selectRentalLedger, type LedgerView } from "./ledger-queries";
import { loadOperatorGst } from "./operator-gst";

/** A rental can take charges and payments once booked, until it is closed. */
const OPEN_FOR_MONEY: ReadonlySet<RentalStatus> = new Set(["booked", "active", "returned"]);

export type LedgerChangeResult =
  | { status: "saved"; ledger: LedgerView }
  | { status: "not_found" | "not_open" | "no_charge_type" | "not_reversible" };

/** The rental, locked so two lines added at once are added in turn; null if not this business's. */
async function lockOpenRental(tx: AnyTransaction, operatorId: string, rentalId: string) {
  const [rental] = await tx
    .select({ id: rentals.id, status: rentals.status })
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)))
    .for("update");
  return rental ?? null;
}

/** Amount and kind only: descriptions and references stay with the ledger (rule 7). */
function logLine(
  tx: AnyTransaction,
  actor: ActingUser,
  line: { id: string; kind: string; amountCents: number; gstCents: number },
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.ledgerLine,
    entityId: line.id,
    action: ACTIVITY_ACTIONS.created,
    valuesAfter: { kind: line.kind, amountCents: line.amountCents, gstCents: line.gstCents },
  });
}

/** Adds the line, logs it and gives back the rental's ledger after it. */
async function insertLine(
  tx: AnyTransaction,
  actor: ActingUser,
  values: typeof ledgerLines.$inferInsert,
): Promise<LedgerChangeResult> {
  const [line] = await tx.insert(ledgerLines).values(values).returning({ id: ledgerLines.id });
  await logLine(tx, actor, {
    id: line!.id,
    kind: values.kind,
    amountCents: values.amountCents,
    gstCents: values.gstCents,
  });
  return {
    status: "saved",
    ledger: ledgerViewOf(await selectRentalLedger(tx, actor.operatorId, values.rentalId)),
  };
}

/** A damage record of this business, if one was given. */
async function damageOfBusiness(
  tx: AnyTransaction,
  operatorId: string,
  damageRecordId: string | undefined,
): Promise<string | null | "missing"> {
  if (!damageRecordId) {
    return null;
  }
  const [record] = await tx
    .select({ id: damageRecords.id })
    .from(damageRecords)
    .where(and(eq(damageRecords.id, damageRecordId), eq(damageRecords.operatorId, operatorId)));
  return record ? record.id : "missing";
}

/**
 * Adds a one-off charge. Its GST comes from its type's treatment and the
 * business's registration on the charge's date, and is stored on the line
 * for good (rule 9).
 */
export async function addCharge(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  input: ChargeInput & { damageRecordId?: string },
): Promise<LedgerChangeResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<LedgerChangeResult> => {
    const rental = await lockOpenRental(tx, actor.operatorId, rentalId);
    if (!rental) {
      return { status: "not_found" };
    }
    if (!OPEN_FOR_MONEY.has(rental.status)) {
      return { status: "not_open" };
    }
    const chargeType = await usableChargeType(tx, actor.operatorId, input.chargeTypeId);
    const damageRecordId = await damageOfBusiness(tx, actor.operatorId, input.damageRecordId);
    if (!chargeType || damageRecordId === "missing") {
      return { status: "no_charge_type" };
    }
    const gst = await loadOperatorGst(tx, actor.operatorId);
    return insertLine(tx, actor, {
      operatorId: actor.operatorId,
      rentalId,
      kind: "charge",
      chargeTypeId: chargeType.id,
      amountCents: input.amountCents,
      gstCents: gstForLine(
        input.amountCents,
        chargeType.gstTreatment,
        isGstRegisteredOn(gst.registeredFrom, input.effectiveOn),
      ),
      description: input.description,
      effectiveOn: input.effectiveOn,
      damageRecordId,
      createdByUserId: actor.userId,
    });
  });
}

/** Records a payment received by hand (cash or bank transfer). It carries no GST of its own. */
export async function recordPayment(
  database: AnyDatabase,
  actor: ActingUser,
  rentalId: string,
  input: ManualPaymentInput,
): Promise<LedgerChangeResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<LedgerChangeResult> => {
    const rental = await lockOpenRental(tx, actor.operatorId, rentalId);
    if (!rental) {
      return { status: "not_found" };
    }
    if (!OPEN_FOR_MONEY.has(rental.status)) {
      return { status: "not_open" };
    }
    return insertLine(tx, actor, {
      operatorId: actor.operatorId,
      rentalId,
      kind: "payment",
      amountCents: input.amountCents,
      gstCents: 0,
      description: "Payment received",
      effectiveOn: input.occurredOn,
      method: input.method,
      reference: input.reference,
      createdByUserId: actor.userId,
    });
  });
}

/**
 * Corrects a line the only way the ledger allows (rule 11): a reversal that
 * undoes it exactly (amount and GST), dated today, with the reason as its
 * description. Each line once; never a reversal of a reversal.
 */
export async function reverseLine(
  database: AnyDatabase,
  actor: ActingUser,
  target: { rentalId: string; lineId: string },
  input: ReversalInput,
  today: string,
): Promise<LedgerChangeResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<LedgerChangeResult> => {
    const rental = await lockOpenRental(tx, actor.operatorId, target.rentalId);
    if (!rental) {
      return { status: "not_found" };
    }
    const ledger = ledgerViewOf(await selectRentalLedger(tx, actor.operatorId, target.rentalId));
    const reversed = ledger.lines.find((line) => line.id === target.lineId);
    if (!reversed || !ledger.reversibleIds.has(reversed.id)) {
      return { status: reversed ? "not_reversible" : "not_found" };
    }
    return insertLine(tx, actor, {
      operatorId: actor.operatorId,
      rentalId: target.rentalId,
      kind: "reversal",
      amountCents: reversed.amountCents,
      gstCents: reversed.gstCents,
      description: input.note,
      effectiveOn: today,
      reversesId: reversed.id,
      createdByUserId: actor.userId,
    });
  });
}
