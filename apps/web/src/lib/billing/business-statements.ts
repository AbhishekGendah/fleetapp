import {
  businessStatementFigures,
  describeErrorForLog,
  type BusinessStatementFigures,
  type DocumentEmailOutcome,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  documentEmails,
  issuedDocuments,
  renters,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, inArray } from "drizzle-orm";

import { recordUserChange } from "../acting-user";
import { recordEmailTries } from "../contracts/document-copies";
import {
  recordRenterStatement,
  reserveRenterDocumentFile,
  saveReservedPdf,
  type IssuingActor,
} from "../contracts/issued-documents";
import { selectRenterLedger, type LedgerLineView } from "../ledger/ledger-queries";
import { billedToOf, type BilledTo } from "./billed-to";
import {
  loadBillingContext,
  type BillingContext,
  type BillingDependencies,
} from "./billing-context";
import { loadLineDriverNames } from "./billing-documents";
import { readIssuedPdf } from "./billing-queries";
import {
  selectBondsHeld,
  selectRenterRentalCars,
  type RenterRentalCar,
} from "../renters/business-money-cards";
import { emailBillingDocument } from "./billing-run";
import {
  BUSINESS_STATEMENT_TITLE,
  renderBusinessStatementPdf,
  type BusinessStatementPdf,
  type StatementCar,
} from "./business-statement-pdf";
import type { StatementRange } from "./statement-input";

const STATEMENT_KIND = "statement";
/** What the email says it covers, in place of one rental's car. */
const ACROSS_ITS_CARS = "all its cars";
const STATEMENT_AMOUNT_LINE =
  "It shows every charge and payment on each of its cars, and what is owed on each.";

/** A business, as its statement addresses it and emails it. */
interface StatementBusiness {
  billedTo: BilledTo;
  email: string | null;
}

/** The business Renter, or null if it isn't the Operator's business Renter. */
async function selectStatementBusiness(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<StatementBusiness | null> {
  const [row] = await tx
    .select({
      kind: renters.kind,
      fullName: renters.fullName,
      tradingName: renters.tradingName,
      abn: renters.abn,
      contactName: renters.contactName,
      businessAddress: renters.businessAddress,
      postalAddress: renters.postalAddress,
      email: renters.email,
    })
    .from(renters)
    .where(and(eq(renters.id, renterId), eq(renters.operatorId, operatorId)));
  if (!row || row.kind !== "organisation") {
    return null;
  }
  const { email, ...columns } = row;
  return { billedTo: billedToOf(columns), email };
}

/**
 * Each car's heading: the cars its lines in the days asked were for, and the
 * drivers who had it on those lines in turn (from the possession records);
 * with only a balance brought forward, its car and driver now (review). Names
 * only: never a licence or date of birth. Pure.
 */
export function statementCarsOf(
  rentalRows: readonly RenterRentalCar[],
  figures: BusinessStatementFigures<LedgerLineView>,
  driverNames: ReadonlyMap<string, string>,
): Map<string, StatementCar> {
  return new Map(
    rentalRows.map((rental) => {
      const inDays = (figures.cars.find((car) => car.rentalId === rental.id)?.entries ?? []).map(
        (entry) => entry.line,
      );
      const regos =
        inDays.length > 0 ? [...new Set(inDays.map((item) => item.rego))] : [rental.rego];
      const driverIds =
        inDays.length > 0
          ? [...new Set(inDays.flatMap((item) => (item.driverId ? [item.driverId] : [])))]
          : [rental.driverId].filter((id) => id !== null);
      const car: StatementCar = {
        rentalId: rental.id,
        carText: `${regos.join(" then ")} · ${rental.make} ${rental.model}`,
        driverNames: driverIds.flatMap((id) => {
          const name = driverNames.get(id);
          return name ? [name] : [];
        }),
      };
      return [rental.id, car];
    }),
  );
}

/** Everything the statement is made from, read in one transaction. */
async function loadStatementData(tx: AnyTransaction, operatorId: string, renterId: string) {
  const business = await selectStatementBusiness(tx, operatorId, renterId);
  if (!business) {
    return null;
  }
  // One read of every line, so the cars and the totals come from the same lines (rule 11).
  const lines = await selectRenterLedger(tx, operatorId, renterId);
  const rentalRows = await selectRenterRentalCars(tx, operatorId, renterId);
  const driverNames = await loadLineDriverNames(tx, operatorId, business.billedTo, [
    ...lines,
    ...rentalRows,
  ]);
  const bonds = await selectBondsHeld(tx, operatorId, rentalRows);
  return {
    business,
    lines,
    rentalRows,
    driverNames,
    bonds: {
      heldCents: bonds.reduce((total, bond) => total + bond.heldCents, 0),
      rentalCount: bonds.length,
    },
  };
}

export type BusinessStatementResult =
  | { status: "issued"; issuedDocumentId: string; emailOutcome: DocumentEmailOutcome | null }
  /** Archived or retired: no new statement (review), though its old ones stay. */
  | { status: "not_found" | "too_big" | "not_current" };

/** Emails the statement to the business's contact and keeps the try; never throws. */
async function emailStatement(
  deps: BillingDependencies,
  context: Pick<BillingContext, "business" | "operatorName">,
  business: StatementBusiness,
  document: {
    issuedDocumentId: string;
    pdf: Uint8Array;
    operatorId: string;
    sentByUserId: string;
  },
): Promise<DocumentEmailOutcome> {
  const outcome: DocumentEmailOutcome = !business.email
    ? "no_address"
    : (await emailBillingDocument(
          deps,
          context,
          {
            billedTo: business.billedTo,
            renterEmail: business.email,
            rentalSummary: ACROSS_ITS_CARS,
          },
          {
            title: BUSINESS_STATEMENT_TITLE,
            numberText: null,
            amountLine: STATEMENT_AMOUNT_LINE,
            pdf: document.pdf,
          },
        ))
      ? "sent"
      : "failed";
  await recordEmailTries(
    deps.database,
    {
      operatorId: document.operatorId,
      documentId: document.issuedDocumentId,
      sentByUserId: document.sentByUserId,
    },
    [{ recipient: "renter", outcome }],
  );
  // Who sent it and when, never to which address (rule 7), as "Email again" on a rental's papers.
  await withTenant(deps.database, document.operatorId, (tx) =>
    recordUserChange(
      tx,
      { userId: document.sentByUserId, operatorId: document.operatorId },
      {
        entityType: ACTIVITY_ENTITY_TYPES.issuedDocument,
        entityId: document.issuedDocumentId,
        action: ACTIVITY_ACTIONS.sent,
      },
    ),
  );
  return outcome;
}

/**
 * What the statement is made of, read and added up before it is issued:
 * the business as addressed, and the PDF's content. Null if the Renter is
 * not the Operator's business Renter.
 */
export async function prepareBusinessStatement(
  deps: BillingDependencies,
  operatorId: string,
  renterId: string,
  range: StatementRange,
): Promise<{
  context: BillingContext;
  business: StatementBusiness;
  input: BusinessStatementPdf;
} | null> {
  const context = await loadBillingContext(deps, operatorId);
  const loaded = await withTenant(deps.database, operatorId, (tx) =>
    loadStatementData(tx, operatorId, renterId),
  );
  if (!loaded) {
    return null;
  }
  const figures = businessStatementFigures(loaded.lines, range.fromDate, range.toDate);
  return {
    context,
    business: loaded.business,
    input: {
      parties: {
        business: context.business,
        branding: context.branding,
        billedTo: loaded.business.billedTo,
      },
      issuedOn: context.today,
      fromDate: range.fromDate,
      toDate: range.toDate,
      figures,
      cars: statementCarsOf(loaded.rentalRows, figures, loaded.driverNames),
      bonds: loaded.bonds,
      howToPay: context.howToPay,
    },
  };
}

/**
 * A statement across all of a business Renter's cars for the days asked
 * (docs/plans/business-renters.md, slice 5): every figure added up from its
 * rentals' ledgers in one read (rule 11), issued once and never changed
 * (rule 12) as the business's own document (Migration B), and emailed to
 * its contact when asked. Not a tax invoice, so it takes no number.
 */
export async function issueBusinessStatement(
  deps: BillingDependencies,
  actor: IssuingActor & { userId: string },
  renterId: string,
  request: StatementRange & { isEmailed: boolean },
): Promise<BusinessStatementResult> {
  const prepared = await prepareBusinessStatement(deps, actor.operatorId, renterId, request);
  if (!prepared) {
    return { status: "not_found" };
  }
  const { context, business, input } = prepared;
  const pdf = await renderBusinessStatementPdf(input);
  const reserved = await reserveRenterDocumentFile(deps, actor, renterId, pdf.byteLength);
  if (!reserved) {
    return { status: "not_found" };
  }
  const stored = await saveReservedPdf(deps, reserved, {
    kind: STATEMENT_KIND,
    templateVersionId: null,
    pdf,
  });
  if ("status" in stored) {
    return stored;
  }
  const issued = await withTenant(deps.database, actor.operatorId, (tx) =>
    recordRenterStatement(tx, deps, actor, stored, renterId),
  );
  // Its stored PDF, never confirmed, goes with the nightly clean-up of abandoned uploads.
  if (!issued) {
    return { status: "not_current" };
  }
  const emailOutcome = request.isEmailed
    ? await emailIssuedStatement(deps, context, business, {
        issuedDocumentId: issued.documentId,
        pdf,
        operatorId: actor.operatorId,
        sentByUserId: actor.userId,
      })
    : null;
  return { status: "issued", issuedDocumentId: issued.documentId, emailOutcome };
}

/**
 * The statement is issued by now, so a failure emailing it or recording the
 * send never fails the action (review): it says "not emailed, use Email
 * again", so trying again never issues a second version. Logged by ids only.
 */
async function emailIssuedStatement(
  ...args: Parameters<typeof emailStatement>
): Promise<DocumentEmailOutcome> {
  try {
    return await emailStatement(...args);
  } catch (error) {
    console.error(
      `Emailing statement ${args[3].issuedDocumentId} as it was made failed`,
      describeErrorForLog(error),
    );
    return "failed";
  }
}

/** One of a business's statements across its cars, as its Money tab lists it. */
export interface RenterStatementSummary {
  id: string;
  version: number;
  issuedAt: Date;
  /** The latest try at emailing it to the contact; none if never emailed. */
  lastEmail: { outcome: DocumentEmailOutcome; triedAt: Date } | null;
}

/** The Renter's statements across their cars, newest first, with how each was last emailed. */
export async function listRenterStatements(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
): Promise<RenterStatementSummary[]> {
  return withTenant(database, operatorId, async (tx) => {
    const documents = await tx
      .select({
        id: issuedDocuments.id,
        version: issuedDocuments.version,
        issuedAt: issuedDocuments.issuedAt,
      })
      .from(issuedDocuments)
      .where(
        and(
          eq(issuedDocuments.operatorId, operatorId),
          eq(issuedDocuments.renterId, renterId),
          eq(issuedDocuments.kind, STATEMENT_KIND),
        ),
      )
      .orderBy(desc(issuedDocuments.version));
    const tries =
      documents.length === 0
        ? []
        : await tx
            .select({
              documentId: documentEmails.documentId,
              outcome: documentEmails.outcome,
              triedAt: documentEmails.triedAt,
            })
            .from(documentEmails)
            .where(
              and(
                eq(documentEmails.operatorId, operatorId),
                inArray(
                  documentEmails.documentId,
                  documents.map((document) => document.id),
                ),
              ),
            )
            .orderBy(desc(documentEmails.triedAt));
    return documents.map((document) => {
      const last = tries.find((attempt) => attempt.documentId === document.id);
      return {
        ...document,
        lastEmail: last ? { outcome: last.outcome, triedAt: last.triedAt } : null,
      };
    });
  });
}

/** The statement, if it is this Renter's. */
async function selectStatementFile(
  tx: AnyTransaction,
  operatorId: string,
  target: { renterId: string; issuedDocumentId: string },
) {
  const [row] = await tx
    .select({ id: issuedDocuments.id })
    .from(issuedDocuments)
    .where(
      and(
        eq(issuedDocuments.id, target.issuedDocumentId),
        eq(issuedDocuments.operatorId, operatorId),
        eq(issuedDocuments.renterId, target.renterId),
      ),
    );
  return row ?? null;
}

/** Whether the document is one of this Renter's statements: for opening it from their page. */
export async function isRenterStatement(
  database: AnyDatabase,
  operatorId: string,
  target: { renterId: string; issuedDocumentId: string },
): Promise<boolean> {
  const file = await withTenant(database, operatorId, (tx) =>
    selectStatementFile(tx, operatorId, target),
  );
  return file !== null;
}

/** Emails one of the business's statements to its contact again, as it was issued. */
export async function emailRenterStatementAgain(
  deps: BillingDependencies,
  actor: { operatorId: string; userId: string },
  target: { renterId: string; issuedDocumentId: string },
): Promise<DocumentEmailOutcome | "not_found"> {
  const [loaded, context] = await Promise.all([
    withTenant(deps.database, actor.operatorId, async (tx) => {
      const file = await selectStatementFile(tx, actor.operatorId, target);
      const business = file
        ? await selectStatementBusiness(tx, actor.operatorId, target.renterId)
        : null;
      return file && business ? { file, business } : null;
    }),
    loadBillingContext(deps, actor.operatorId),
  ]);
  const pdf = loaded ? await readIssuedPdf(deps, actor.operatorId, target.issuedDocumentId) : null;
  if (!loaded || !pdf) {
    return "not_found";
  }
  try {
    return await emailStatement(deps, context, loaded.business, {
      issuedDocumentId: target.issuedDocumentId,
      pdf,
      operatorId: actor.operatorId,
      sentByUserId: actor.userId,
    });
  } catch (error) {
    console.error("Emailing a statement again failed", describeErrorForLog(error));
    return "failed";
  }
}
