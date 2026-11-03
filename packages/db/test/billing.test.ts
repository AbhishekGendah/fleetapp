import { randomUUID } from "node:crypto";

import { buildFileKey } from "@fleetapp/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { AnyTransaction } from "../src/client";
import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  addTestCar,
  addTestRenter,
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  testRentalRow,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const FIRST_INVOICE = 1001;
const ON_DAY = "2027-03-02";
const PDF_BYTES = 2_000;
const FINGERPRINT = "a".repeat(64);

type Series = (typeof schema.numberingSeriesEnum.enumValues)[number];
type DocumentKind = (typeof schema.billingDocumentKindEnum.enumValues)[number];

/**
 * Invoices, credit notes and receipts (rules 12 and 17): numbers in
 * sequence with no gaps and no repeats, even when two are issued at once;
 * each ledger line on one document of its own kind; nothing changed or
 * removed; and all of it the business's own, never the admin app's.
 */
describe("invoices and receipts", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let renterId: string;
  let rentTypeId: string;
  let issuedVersion = 1;

  async function addRental(): Promise<string> {
    const vehicleId = await addTestCar(web.db, operatorAId);
    const [rental] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(testRentalRow({ operatorId: operatorAId, renterId, vehicleId }))
        .returning({ id: schema.rentals.id }),
    );
    return rental!.id;
  }

  async function addLine(
    rentalId: string,
    values: Partial<typeof schema.ledgerLines.$inferInsert> = {},
  ): Promise<string> {
    const [line] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.ledgerLines)
        .values({
          operatorId: operatorAId,
          rentalId,
          kind: "charge",
          chargeTypeId: rentTypeId,
          amountCents: 350_00,
          gstCents: 31_82,
          description: "Weekly rent",
          effectiveOn: ON_DAY,
          ...values,
        })
        .returning({ id: schema.ledgerLines.id }),
    );
    return line!.id;
  }

  /** Takes the next number, as issuing does: in the transaction, moving it on by one. */
  async function takeNumber(tx: AnyTransaction, series: Series): Promise<number> {
    await tx
      .insert(schema.documentNumbering)
      .values({ operatorId: operatorAId, series, prefix: "INV-", nextNumber: FIRST_INVOICE })
      .onConflictDoNothing();
    const [taken] = await tx
      .update(schema.documentNumbering)
      .set({
        nextNumber: sql`${schema.documentNumbering.nextNumber} + 1`,
        isStarted: true,
      })
      .where(
        and(
          eq(schema.documentNumbering.operatorId, operatorAId),
          eq(schema.documentNumbering.series, series),
        ),
      )
      .returning({ next: schema.documentNumbering.nextNumber });
    return taken!.next - 1;
  }

  /** An issued PDF to hang a document on. */
  async function addIssuedPdf(tx: AnyTransaction, rentalId: string): Promise<string> {
    const fileId = randomUUID();
    await tx.insert(schema.files).values({
      id: fileId,
      operatorId: operatorAId,
      purpose: "issued_document",
      storageArea: "general",
      objectKey: buildFileKey(operatorAId, "issued_document", fileId),
      contentType: "application/pdf",
      sizeBytes: PDF_BYTES,
      confirmedAt: new Date(),
    });
    const [document] = await tx
      .insert(schema.issuedDocuments)
      .values({
        operatorId: operatorAId,
        rentalId,
        kind: "contract",
        version: issuedVersion++,
        fileId,
        sha256: FINGERPRINT,
      })
      .returning({ id: schema.issuedDocuments.id });
    return document!.id;
  }

  async function insertDocument(
    tx: AnyTransaction,
    rentalId: string,
    kind: DocumentKind,
    number: number,
  ): Promise<string> {
    const [document] = await tx
      .insert(schema.billingDocuments)
      .values({
        operatorId: operatorAId,
        rentalId,
        kind,
        number,
        numberText: `INV-${number}`,
        issuedOn: ON_DAY,
        isTaxDocument: true,
        totalCents: 350_00,
        gstCents: 31_82,
        issuedDocumentId: await addIssuedPdf(tx, rentalId),
      })
      .returning({ id: schema.billingDocuments.id });
    return document!.id;
  }

  /** Issues a document of `kind` for the lines, as the app does, in one transaction. */
  function issue(
    rentalId: string,
    kind: DocumentKind,
    lineIds: readonly string[],
  ): Promise<{ id: string; number: number }> {
    return withTenant(web.db, operatorAId, async (tx) => {
      const number = await takeNumber(tx, kind === "receipt" ? "receipt" : "invoice");
      const id = await insertDocument(tx, rentalId, kind, number);
      for (const ledgerLineId of lineIds) {
        await tx.insert(schema.billingDocumentLines).values({
          operatorId: operatorAId,
          rentalId,
          billingDocumentId: id,
          ledgerLineId,
        });
      }
      return { id, number };
    });
  }

  async function nextInvoiceNumber(): Promise<number> {
    const [row] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .select({ next: schema.documentNumbering.nextNumber })
        .from(schema.documentNumbering)
        .where(
          and(
            eq(schema.documentNumbering.operatorId, operatorAId),
            eq(schema.documentNumbering.series, "invoice"),
          ),
        ),
    );
    return row!.next;
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    renterId = await addTestRenter(web.db, operatorAId);
    const [rentType] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.chargeTypes)
        .values({ operatorId: operatorAId, builtIn: "weekly_rent" })
        .returning({ id: schema.chargeTypes.id }),
    );
    rentTypeId = rentType!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  it("lets the starting number be set until the first document, then only moves it on by one", async () => {
    await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.documentNumbering)
        .values({ operatorId: operatorAId, series: "invoice", prefix: "INV-", nextNumber: 500 }),
    );
    const setBeforeStart = withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.documentNumbering)
        .set({ nextNumber: FIRST_INVOICE })
        .where(eq(schema.documentNumbering.operatorId, operatorAId)),
    );
    await setBeforeStart;
    const rentalId = await addRental();
    const first = await issue(rentalId, "invoice", [await addLine(rentalId)]);

    const jumped = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.documentNumbering)
          .set({ nextNumber: FIRST_INVOICE + 10 })
          .where(eq(schema.documentNumbering.operatorId, operatorAId)),
      ),
    );
    const reset = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.documentNumbering)
          .set({ isStarted: false })
          .where(eq(schema.documentNumbering.operatorId, operatorAId)),
      ),
    );

    expect(first.number).toBe(FIRST_INVOICE);
    expect([jumped, reset]).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
    expect(await nextInvoiceNumber()).toBe(FIRST_INVOICE + 1);
  });

  it("uses no number when an issue fails, and refuses a number taken without its document", async () => {
    const rentalId = await addRental();
    const before = await nextInvoiceNumber();

    const failed = await withTenant(web.db, operatorAId, async (tx) => {
      await takeNumber(tx, "invoice");
      throw new Error("The PDF could not be stored.");
    }).catch((error: unknown) => error);
    const skipped = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) => takeNumber(tx, "invoice")),
    );
    const notYetTaken = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) => insertDocument(tx, rentalId, "invoice", before + 50)),
    );
    const next = await issue(rentalId, "invoice", [await addLine(rentalId)]);

    expect(failed).toBeInstanceOf(Error);
    expect([skipped, notYetTaken]).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
    expect(next.number).toBe(before);
  });

  it("gives documents issued at the same moment the next numbers, with no repeats or gaps", async () => {
    const rentalIds = await Promise.all(Array.from({ length: 6 }, () => addRental()));
    const lineIds = await Promise.all(rentalIds.map((rentalId) => addLine(rentalId)));
    const before = await nextInvoiceNumber();

    const issued = await Promise.all(
      rentalIds.map((rentalId, index) => issue(rentalId, "invoice", [lineIds[index]!])),
    );

    const numbers = issued.map((document) => document.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 6 }, (_, index) => before + index));
  });

  it("numbers receipts on their own, and an invoice number is never used twice", async () => {
    const rentalId = await addRental();
    const payment = await addLine(rentalId, {
      kind: "payment",
      chargeTypeId: null,
      method: "cash",
      gstCents: 0,
      description: "Payment received",
    });
    const receipt = await issue(rentalId, "receipt", [payment]);
    const repeated = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, async (tx) => {
        const number = await takeNumber(tx, "invoice");
        await insertDocument(tx, rentalId, "invoice", number);
        await insertDocument(tx, rentalId, "credit_note", number);
      }),
    );

    expect(receipt.number).toBe(FIRST_INVOICE);
    expect(repeated).toBe(UNIQUE_VIOLATION);
  });

  it("puts each line on one document of its own kind, within its own rental", async () => {
    const rentalId = await addRental();
    const otherRentalId = await addRental();
    const charge = await addLine(rentalId);
    await issue(rentalId, "invoice", [charge]);

    const twice = await postgresErrorCodeOf(issue(rentalId, "invoice", [charge]));
    const onReceipt = await postgresErrorCodeOf(
      issue(rentalId, "receipt", [await addLine(rentalId)]),
    );
    const otherRental = await postgresErrorCodeOf(
      issue(otherRentalId, "invoice", [await addLine(rentalId)]),
    );

    expect([twice, onReceipt, otherRental]).toEqual([
      UNIQUE_VIOLATION,
      CHECK_VIOLATION,
      FOREIGN_KEY_VIOLATION,
    ]);
  });

  it("tells the nightly catch-up which businesses have lines on no document, and nothing more", async () => {
    const rentalId = await addRental();
    await addLine(rentalId);
    const result = await web.db.execute(
      sql`SELECT * FROM app.operators_with_unbilled_lines(${new Date(Date.now() - 60_000).toISOString()}::timestamptz) AS operator_id`,
    );
    const operatorIds = (result.rows as { operator_id: string }[]).map((row) => row.operator_id);

    expect(operatorIds).toContain(operatorAId);
    expect(operatorIds).not.toContain(operatorBId);
  });

  it("never changes or removes a document, and keeps them from other Operators and the admin app", async () => {
    const rentalId = await addRental();
    const document = await issue(rentalId, "invoice", [await addLine(rentalId)]);
    const thisDocument = eq(schema.billingDocuments.id, document.id);

    const codes = [
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.update(schema.billingDocuments).set({ totalCents: 1 }).where(thisDocument),
        ),
      ),
      await postgresErrorCodeOf(
        superuser.db.update(schema.billingDocuments).set({ totalCents: 1 }).where(thisDocument),
      ),
      await postgresErrorCodeOf(superuser.db.delete(schema.billingDocuments).where(thisDocument)),
      await postgresErrorCodeOf(
        superuser.db
          .delete(schema.billingDocumentLines)
          .where(eq(schema.billingDocumentLines.billingDocumentId, document.id)),
      ),
      await postgresErrorCodeOf(
        superuser.db
          .delete(schema.documentNumbering)
          .where(eq(schema.documentNumbering.operatorId, operatorAId)),
      ),
      await postgresErrorCodeOf(admin.db.select().from(schema.billingDocuments)),
      await postgresErrorCodeOf(admin.db.select().from(schema.billingDocumentLines)),
      await postgresErrorCodeOf(admin.db.select().from(schema.documentNumbering)),
    ];
    const seenByB = await withTenant(web.db, operatorBId, async (tx) => ({
      documents: await tx.select().from(schema.billingDocuments),
      lines: await tx.select().from(schema.billingDocumentLines),
      numbering: await tx.select().from(schema.documentNumbering),
    }));

    expect(codes).toEqual([
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.restrictViolation,
      POSTGRES_ERROR_CODES.restrictViolation,
      POSTGRES_ERROR_CODES.restrictViolation,
      POSTGRES_ERROR_CODES.restrictViolation,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    ]);
    expect(seenByB).toEqual({ documents: [], lines: [], numbering: [] });
  });
});
