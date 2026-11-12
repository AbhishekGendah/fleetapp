import {
  billingDocumentTitle,
  documentTotals,
  isTaxDocumentOn,
  ledgerBalanceCents,
  pendingDocuments,
  SERIES_OF_KIND,
  type BillingDocumentKind,
  type RentalStatus,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  billingDocumentLines,
  billingDocuments,
  rentals,
  renters,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { ROW_LOCK } from "@fleetapp/db/row-lock";
import { and, eq, inArray } from "drizzle-orm";

import {
  logActorOf,
  recordIssuedDocument,
  reserveDocumentFile,
  saveReservedPdf,
  type IssuingActor,
} from "../contracts/issued-documents";
import { selectRentalLedger, type LedgerLineView } from "../ledger/ledger-queries";
import { billedToOf, type BilledTo } from "./billed-to";
import type { BillingContext, BillingDependencies } from "./billing-context";
import { renderItemDocumentPdf, renderReceiptPdf, type BillingPdfParties } from "./billing-pdf";
import { takeDocumentNumber } from "./numbering";

/** The rental as its documents name it. */
export interface BillingRental {
  id: string;
  renterId: string;
  status: RentalStatus;
  settingsSnapshot: Record<string, unknown>;
  billedTo: BilledTo;
  /** The Renter's email: for a business, its contact's. */
  renterEmail: string | null;
  rentalSummary: string;
}

/** The rental, locked when asked so two runs issue its documents in turn; null if not the business's. */
export async function loadBillingRental(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
  shouldLock: boolean,
): Promise<BillingRental | null> {
  const ofRental = and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId));
  if (shouldLock) {
    await tx.select({ id: rentals.id }).from(rentals).where(ofRental).for(ROW_LOCK);
  }
  const [row] = await tx
    .select({
      id: rentals.id,
      renterId: rentals.renterId,
      status: rentals.status,
      settingsSnapshot: rentals.settingsSnapshot,
      renter: {
        kind: renters.kind,
        fullName: renters.fullName,
        tradingName: renters.tradingName,
        abn: renters.abn,
        contactName: renters.contactName,
        businessAddress: renters.businessAddress,
        postalAddress: renters.postalAddress,
      },
      renterEmail: renters.email,
      rego: vehicles.rego,
      make: vehicles.make,
      model: vehicles.model,
    })
    .from(rentals)
    .innerJoin(
      renters,
      and(eq(renters.id, rentals.renterId), eq(renters.operatorId, rentals.operatorId)),
    )
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, rentals.vehicleId), eq(vehicles.operatorId, rentals.operatorId)),
    )
    .where(ofRental);
  if (!row) {
    return null;
  }
  const { rego, make, model, renter, ...rental } = row;
  return { ...rental, billedTo: billedToOf(renter), rentalSummary: `${rego} ${make} ${model}` };
}

/**
 * A business's drivers on these lines, by id, to name on its documents
 * (names only: never a licence or date of birth). None for a person, whose
 * documents name no driver.
 */
export async function loadLineDriverNames(
  tx: AnyTransaction,
  operatorId: string,
  billedTo: BilledTo,
  lines: readonly Pick<LedgerLineView, "driverId">[],
): Promise<ReadonlyMap<string, string>> {
  const driverIds = [...new Set(lines.flatMap((item) => (item.driverId ? [item.driverId] : [])))];
  if (billedTo.kind !== "organisation" || driverIds.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select({ id: renters.id, fullName: renters.fullName })
    .from(renters)
    .where(and(eq(renters.operatorId, operatorId), inArray(renters.id, driverIds)));
  return new Map(rows.map((row) => [row.id, row.fullName]));
}

/** One document still needed: its kind, its lines, and the invoice a credit note corrects. */
interface PlannedDocument {
  kind: BillingDocumentKind;
  lineIds: string[];
  relatesToId: string | null;
}

/**
 * The next document the rental's lines need, in order: invoices (rent, then
 * each one-off charge on its own, at once), then credit notes, then receipts.
 */
function nextDocumentFor(lines: readonly LedgerLineView[]): PlannedDocument | null {
  const pending = pendingDocuments(lines);
  const [creditNote] = pending.creditNotes;
  const [receiptLineId] = pending.receiptLineIds;
  if (pending.invoiceLineIds.length > 0) {
    return { kind: "invoice", lineIds: pending.invoiceLineIds, relatesToId: null };
  }
  if (creditNote) {
    return { kind: "credit_note", ...creditNote, relatesToId: creditNote.relatesToDocumentId };
  }
  return receiptLineId ? { kind: "receipt", lineIds: [receiptLineId], relatesToId: null } : null;
}

/** A document just issued, ready to email. */
export interface IssuedBilling {
  billingDocumentId: string;
  /** The fixed PDF's record, which each email of it is recorded against. */
  issuedDocumentId: string;
  kind: BillingDocumentKind;
  title: string;
  numberText: string;
  totalCents: number;
  gstCents: number;
  /** For a receipt: what the Renter owes once it is counted. */
  balanceAfterCents: number;
  pdf: Uint8Array;
}

interface Drafted {
  planned: PlannedDocument;
  title: string;
  numberText: string;
  isTaxDocument: boolean;
  chosen: LedgerLineView[];
  balanceAfterCents: number;
}

function renderDrafted(
  context: BillingContext,
  rental: BillingRental,
  drafted: Drafted,
  allLines: readonly LedgerLineView[],
  driverNames: ReadonlyMap<string, string>,
): Promise<Uint8Array> {
  const parties: BillingPdfParties = {
    business: context.business,
    branding: context.branding,
    billedTo: rental.billedTo,
    rentalSummary: rental.rentalSummary,
    driverNames,
  };
  const corrected = allLines.find((item) => item.documentId === drafted.planned.relatesToId);
  const header = {
    title: drafted.title,
    numberText: drafted.numberText,
    issuedOn: context.today,
    note: corrected?.documentNumberText
      ? `Corrects invoice ${corrected.documentNumberText}.`
      : undefined,
  };
  const [payment] = drafted.chosen;
  if (drafted.planned.kind === "receipt" && payment) {
    return renderReceiptPdf({
      parties,
      header,
      payment,
      balanceAfterCents: drafted.balanceAfterCents,
    });
  }
  return renderItemDocumentPdf({
    parties,
    header,
    lines: drafted.chosen,
    allLines,
    isTaxDocument: drafted.isTaxDocument,
    isReduction: drafted.planned.kind === "credit_note",
    howToPay: drafted.planned.kind === "invoice" ? context.howToPay : "",
  });
}

/** Keeps the document and which lines it is made of, and logs it (amounts only, rule 7). */
async function recordBillingDocument(
  tx: AnyTransaction,
  actor: IssuingActor,
  rentalId: string,
  values: Drafted & { number: number; issuedDocumentId: string; issuedOn: string },
): Promise<{ id: string; totalCents: number; gstCents: number }> {
  const totals = documentTotals(values.chosen);
  const [document] = await tx
    .insert(billingDocuments)
    .values({
      operatorId: actor.operatorId,
      rentalId,
      kind: values.planned.kind,
      number: values.number,
      numberText: values.numberText,
      issuedOn: values.issuedOn,
      isTaxDocument: values.isTaxDocument,
      totalCents: totals.amountCents,
      gstCents: totals.gstCents,
      relatesToId: values.planned.relatesToId,
      issuedDocumentId: values.issuedDocumentId,
    })
    .returning({ id: billingDocuments.id });
  if (!document) {
    throw new Error("The document was not saved.");
  }
  await tx.insert(billingDocumentLines).values(
    values.chosen.map((item) => ({
      operatorId: actor.operatorId,
      rentalId,
      billingDocumentId: document.id,
      ledgerLineId: item.id,
    })),
  );
  await recordActivity(tx, {
    operatorId: actor.operatorId,
    actor: logActorOf(actor),
    entityType: ACTIVITY_ENTITY_TYPES.billingDocument,
    entityId: document.id,
    action: ACTIVITY_ACTIONS.created,
    valuesAfter: {
      kind: values.planned.kind,
      number: values.numberText,
      totalCents: totals.amountCents,
      gstCents: totals.gstCents,
    },
  });
  return { id: document.id, totalCents: totals.amountCents, gstCents: totals.gstCents };
}

/**
 * Whether a document is a tax one. A credit note follows the invoice it
 * corrects (review G8-1): an adjustment note for a tax invoice, a plain
 * credit note otherwise, whatever the business's GST is today.
 */
async function isTaxDocumentFor(
  tx: AnyTransaction,
  operatorId: string,
  context: BillingContext,
  planned: PlannedDocument,
): Promise<boolean> {
  if (planned.kind === "receipt") {
    return false;
  }
  if (planned.kind === "credit_note" && planned.relatesToId) {
    const [corrected] = await tx
      .select({ isTaxDocument: billingDocuments.isTaxDocument })
      .from(billingDocuments)
      .where(
        and(
          eq(billingDocuments.operatorId, operatorId),
          eq(billingDocuments.id, planned.relatesToId),
        ),
      );
    if (corrected) {
      return corrected.isTaxDocument;
    }
  }
  return isTaxDocumentOn(context.gstRegisteredFrom, context.today);
}

/** Takes the number and works out the document's title and lines, inside the issuing transaction. */
async function draftDocument(
  tx: AnyTransaction,
  operatorId: string,
  context: BillingContext,
  planned: PlannedDocument,
  lines: readonly LedgerLineView[],
): Promise<Drafted & { number: number }> {
  const taken = await takeDocumentNumber(tx, operatorId, SERIES_OF_KIND[planned.kind]);
  const isTaxDocument = await isTaxDocumentFor(tx, operatorId, context, planned);
  return {
    planned,
    number: taken.number,
    numberText: taken.numberText,
    isTaxDocument,
    title: billingDocumentTitle(planned.kind, isTaxDocument),
    chosen: lines.filter((item) => planned.lineIds.includes(item.id)),
    balanceAfterCents: ledgerBalanceCents(lines),
  };
}

/** Whether the rental has a document waiting, read without locking: skips a file when none is. */
async function hasDocumentWaiting(
  deps: BillingDependencies,
  operatorId: string,
  rentalId: string,
): Promise<boolean> {
  return withTenant(deps.database, operatorId, async (tx) => {
    const rental = await loadBillingRental(tx, operatorId, rentalId, false);
    const lines = rental ? await selectRentalLedger(tx, operatorId, rentalId) : [];
    return rental !== null && nextDocumentFor(lines) !== null;
  });
}

/**
 * Issues the next document the rental needs, if any (rule 12): its number
 * taken, its PDF made and stored and the document recorded, all in one
 * transaction with the rental locked, so a failure takes no number (rule 17)
 * and two runs at once cannot issue the same lines twice.
 */
export async function issueNextDocument(
  deps: BillingDependencies,
  actor: IssuingActor,
  context: BillingContext,
  rentalId: string,
): Promise<IssuedBilling | null> {
  if (!(await hasDocumentWaiting(deps, actor.operatorId, rentalId))) {
    return null;
  }
  const reserved = await reserveDocumentFile(deps, actor, rentalId, 0);
  if (!reserved) {
    return null;
  }
  return withTenant(deps.database, actor.operatorId, async (tx) => {
    const locked = await loadBillingRental(tx, actor.operatorId, rentalId, true);
    const lines = locked ? await selectRentalLedger(tx, actor.operatorId, rentalId) : [];
    const planned = locked ? nextDocumentFor(lines) : null;
    if (!locked || !planned) {
      return null;
    }
    const drafted = await draftDocument(tx, actor.operatorId, context, planned, lines);
    const driverNames = await loadLineDriverNames(tx, actor.operatorId, locked.billedTo, lines);
    const pdf = await renderDrafted(context, locked, drafted, lines, driverNames);
    const request = { rentalId, kind: planned.kind, templateVersionId: null, pdf };
    const stored = await saveReservedPdf(deps, reserved, request);
    if ("status" in stored) {
      throw new Error("The document's PDF was too big to keep.");
    }
    const issued = await recordIssuedDocument(tx, deps, actor, stored);
    const saved = await recordBillingDocument(tx, actor, rentalId, {
      ...drafted,
      issuedDocumentId: issued.documentId,
      issuedOn: context.today,
    });
    return {
      billingDocumentId: saved.id,
      issuedDocumentId: issued.documentId,
      ...drafted,
      ...saved,
      kind: planned.kind,
      pdf,
    };
  });
}
