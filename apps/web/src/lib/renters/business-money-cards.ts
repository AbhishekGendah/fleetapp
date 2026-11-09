import {
  bondHeldCents,
  directDebitState,
  type BillingDocumentKind,
  type DirectDebitState,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { billingDocuments, bondMovements, rentals, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { selectMandates } from "../payments/renter-payment-records";

/** How many of a business's latest invoices its Money tab lists; each rental lists all of its own. */
export const LATEST_INVOICES_SHOWN = 5;

/** The bond held on one of a business's rentals. */
export interface RentalBondHeld {
  rentalId: string;
  rego: string;
  heldCents: number;
}

/**
 * The bond held on each of the Renter's rentals that holds any, each added
 * up from its own bond account (bonds are per car: decision 6), kept apart
 * from what is owed. Inside the caller's transaction.
 */
export async function selectBondsHeld(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<RentalBondHeld[]> {
  const theirRentals = await tx
    .select({ id: rentals.id, rego: vehicles.rego })
    .from(rentals)
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, rentals.vehicleId), eq(vehicles.operatorId, rentals.operatorId)),
    )
    .where(and(eq(rentals.operatorId, operatorId), eq(rentals.renterId, renterId)))
    .orderBy(asc(rentals.plannedStart));
  const movements =
    theirRentals.length === 0
      ? []
      : await tx
          .select({
            id: bondMovements.id,
            rentalId: bondMovements.rentalId,
            kind: bondMovements.kind,
            amountCents: bondMovements.amountCents,
            reversesId: bondMovements.reversesId,
          })
          .from(bondMovements)
          .where(
            and(
              eq(bondMovements.operatorId, operatorId),
              inArray(
                bondMovements.rentalId,
                theirRentals.map((rental) => rental.id),
              ),
            ),
          )
          .orderBy(asc(bondMovements.createdAt));
  return theirRentals
    .map((rental) => ({
      rentalId: rental.id,
      rego: rental.rego,
      heldCents: bondHeldCents(movements.filter((entry) => entry.rentalId === rental.id)),
    }))
    .filter((bond) => bond.heldCents > 0);
}

/** One of a business's latest invoices (or credit notes), with the car it is for. */
export interface BusinessInvoice {
  issuedDocumentId: string;
  rentalId: string;
  rego: string;
  kind: BillingDocumentKind;
  numberText: string;
  isTaxDocument: boolean;
  issuedOn: string;
  totalCents: number;
}

/** What a business's Money tab shows beside its ledger: how it pays, its bonds and latest invoices. */
export interface BusinessMoneyCards {
  /** Its one direct debit, for all its cars (decision 6: each car debited on its own). */
  directDebit: DirectDebitState;
  bonds: RentalBondHeld[];
  latestInvoices: BusinessInvoice[];
}

function selectLatestInvoices(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<BusinessInvoice[]> {
  return tx
    .select({
      issuedDocumentId: billingDocuments.issuedDocumentId,
      rentalId: billingDocuments.rentalId,
      rego: vehicles.rego,
      kind: billingDocuments.kind,
      numberText: billingDocuments.numberText,
      isTaxDocument: billingDocuments.isTaxDocument,
      issuedOn: billingDocuments.issuedOn,
      totalCents: billingDocuments.totalCents,
    })
    .from(billingDocuments)
    .innerJoin(
      rentals,
      and(
        eq(rentals.id, billingDocuments.rentalId),
        eq(rentals.operatorId, billingDocuments.operatorId),
      ),
    )
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, rentals.vehicleId), eq(vehicles.operatorId, rentals.operatorId)),
    )
    .where(
      and(
        eq(billingDocuments.operatorId, operatorId),
        eq(rentals.renterId, renterId),
        inArray(billingDocuments.kind, ["invoice", "credit_note"]),
      ),
    )
    .orderBy(desc(billingDocuments.issuedOn), desc(billingDocuments.number))
    .limit(LATEST_INVOICES_SHOWN);
}

/** Everything the business's Money tab shows beside its ledger, in its Operator's tenant context. */
export async function loadBusinessMoneyCards(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
): Promise<BusinessMoneyCards> {
  return withTenant(database, operatorId, async (tx) => {
    const [mandates, bonds, latestInvoices] = await Promise.all([
      selectMandates(tx, operatorId, renterId),
      selectBondsHeld(tx, operatorId, renterId),
      selectLatestInvoices(tx, operatorId, renterId),
    ]);
    return { directDebit: directDebitState(mandates), bonds, latestInvoices };
  });
}
