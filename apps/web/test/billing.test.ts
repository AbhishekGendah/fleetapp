import { withTenant } from "@fleetapp/db/tenant-context";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { operators } from "@fleetapp/db/schema";
import type { EmailMessage } from "@fleetapp/email";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import type { BillingDependencies } from "../src/lib/billing/billing-context";
import { listBillingDocuments, loadBillingDocumentPdf } from "../src/lib/billing/billing-queries";
import { catchUpOperator, issuePendingDocuments } from "../src/lib/billing/billing-run";
import { emailBillingDocumentAgain, issueStatement } from "../src/lib/billing/billing-statements";
import { loadNumbering, saveNumbering } from "../src/lib/billing/numbering";
import { listChargeTypes } from "../src/lib/ledger/charge-types";
import { loadRentalLedger } from "../src/lib/ledger/ledger-queries";
import { addCharge, recordPayment, reverseLine } from "../src/lib/ledger/ledger-records";
import { chargeRentFor } from "../src/lib/ledger/rent-job";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { checklistKit } from "./handover-fixtures";
import { recordingEmailSender } from "./renter-link-fixtures";

/**
 * Every moment is in 2030 on Perth's clock (UTC+8), so each run sees the
 * same periods; the test rentals charge rent on Tuesdays.
 */
const HANDOVER_TUESDAY = new Date("2030-04-02T02:00:00Z");
const WEDNESDAY_3RD = new Date("2030-04-03T04:00:00Z");
const EARLY_WEDNESDAY_10TH = new Date("2030-04-09T17:00:00Z");
const FIRST_INVOICE = "INV-1001";
const LONG_AGO = new Date("2020-01-01T00:00:00Z");

describe("invoices, credit notes and receipts", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let sentEmails: EmailMessage[];
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let kit: ReturnType<typeof checklistKit>;

  function deps(at: Date): BillingDependencies {
    return {
      database: web.db,
      storage,
      emailSender: recordingEmailSender(sentEmails),
      now: () => at,
    };
  }

  async function typeId(label: string): Promise<string> {
    const types = await listChargeTypes(web.db, actor.operatorId);
    return types.find((type) => type.label === label)!.id;
  }

  /** A rental out since Tuesday 2 April, its first week charged. */
  async function rentalCharged(): Promise<string> {
    const { rentalId } = await kit.rentalOut(HANDOVER_TUESDAY);
    await chargeRentFor(web.db, actor.operatorId, WEDNESDAY_3RD, [rentalId]);
    return rentalId;
  }

  async function documentsOf(rentalId: string) {
    return (await listBillingDocuments(web.db, actor.operatorId, rentalId)).map((document) => [
      document.kind,
      document.numberText,
      document.totalCents,
    ]);
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    sentEmails = [];
    actor = await seedOperatorWithUser(admin, "Invoice Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Invoice Rentals Pty Ltd");
    // Set as the business sets it, in Settings (the admin app can't).
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .update(operators)
        .set({ gstRegistered: true, gstRegisteredFrom: "2020-01-01", email: "hi@invoice.test" })
        .where(eq(operators.id, actor.operatorId)),
    );
    kit = checklistKit(web, storage, sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("issues a tax invoice for the week's rent, numbered from the start, and emails it", async () => {
    const rentalId = await rentalCharged();
    sentEmails.length = 0;

    const issued = await issuePendingDocuments(deps(WEDNESDAY_3RD), actor, rentalId);
    const again = await issuePendingDocuments(deps(WEDNESDAY_3RD), actor, rentalId);

    expect(issued.map((document) => [document.title, document.numberText])).toEqual([
      ["Tax invoice", FIRST_INVOICE],
    ]);
    expect(issued[0]).toMatchObject({ totalCents: 350_00, gstCents: 31_82 });
    expect(again).toEqual([]);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      subject: `Tax invoice ${FIRST_INVOICE} from Invoice Rentals Pty Ltd`,
      replyTo: "hi@invoice.test",
    });
    expect(sentEmails[0]!.attachments?.[0]?.fileName).toBe(`${FIRST_INVOICE}.pdf`);
    const ledger = await loadRentalLedger(web.db, actor.operatorId, rentalId);
    expect(ledger.lines.map((line) => line.documentNumberText)).toEqual([FIRST_INVOICE]);
    const pdf = await loadBillingDocumentPdf(deps(WEDNESDAY_3RD), actor.operatorId, {
      rentalId,
      issuedDocumentId: (await listBillingDocuments(web.db, actor.operatorId, rentalId))[0]!
        .issuedDocumentId,
    });
    expect(new TextDecoder().decode(pdf!.pdf.slice(0, 5))).toBe("%PDF-");
  });

  it("holds a one-off charge for the next weekly invoice, unless invoiced now", async () => {
    const rentalId = await rentalCharged();
    await issuePendingDocuments(deps(WEDNESDAY_3RD), actor, rentalId);
    await addCharge(web.db, actor, rentalId, {
      chargeTypeId: await typeId("Cleaning"),
      amountCents: 80_00,
      description: "Seats cleaned",
      effectiveOn: "2030-04-04",
    });

    const waiting = await issuePendingDocuments(deps(WEDNESDAY_3RD), actor, rentalId);
    await chargeRentFor(web.db, actor.operatorId, EARLY_WEDNESDAY_10TH, [rentalId]);
    const weekly = await issuePendingDocuments(deps(EARLY_WEDNESDAY_10TH), actor, rentalId);

    expect(waiting).toEqual([]);
    expect(weekly.map((document) => document.totalCents)).toEqual([350_00 + 80_00]);

    await addCharge(web.db, actor, rentalId, {
      chargeTypeId: await typeId("Toll"),
      amountCents: 12_50,
      description: "Bridge toll",
      effectiveOn: "2030-04-10",
    });
    const now = await issuePendingDocuments(deps(EARLY_WEDNESDAY_10TH), actor, rentalId, {
      isInvoicedNow: true,
    });
    expect(now.map((document) => document.totalCents)).toEqual([12_50]);
  });

  it("gives each payment a receipt, and corrects an invoiced charge with an adjustment note", async () => {
    const rentalId = await rentalCharged();
    const [invoice] = await issuePendingDocuments(deps(WEDNESDAY_3RD), actor, rentalId);
    await recordPayment(web.db, actor, rentalId, {
      amountCents: 200_00,
      method: "bank_transfer",
      reference: "ABC123",
      occurredOn: "2030-04-03",
    });
    const rent = (await loadRentalLedger(web.db, actor.operatorId, rentalId)).lines[0]!;
    await reverseLine(
      web.db,
      actor,
      { rentalId, lineId: rent.id },
      { note: "Charged by mistake" },
      "2030-04-03",
    );

    const issued = await issuePendingDocuments(deps(WEDNESDAY_3RD), actor, rentalId);

    expect(issued.map((document) => [document.kind, document.title])).toEqual([
      ["credit_note", "Adjustment note"],
      ["receipt", "Receipt"],
    ]);
    const [adjustment, receipt] = issued;
    expect(Number(adjustment!.numberText.slice(4))).toBe(Number(invoice!.numberText.slice(4)) + 1);
    expect(adjustment).toMatchObject({ totalCents: 350_00, gstCents: 31_82 });
    expect(receipt).toMatchObject({ totalCents: 200_00, balanceAfterCents: -200_00 });
    expect(receipt!.numberText).toMatch(/^RCT-\d+$/);
  });

  it("issues what the daily run charged, once, and refuses no number to a failed issue", async () => {
    const rentalId = await rentalCharged();
    const nextNumber = async () => (await loadNumbering(web.db, actor.operatorId))[0]!.nextNumber;
    const before = await nextNumber();
    const brokenStorage: MemoryFileStorage = {
      ...storage,
      save: () => Promise.reject(new Error("Storage is down.")),
    };
    const failed = await issuePendingDocuments(
      { ...deps(WEDNESDAY_3RD), storage: brokenStorage },
      actor,
      rentalId,
    ).catch((error: unknown) => error);
    expect(await nextNumber()).toBe(before);

    // The run itself sweeps every business in the shared test database; one business's part is enough here.
    const first = await catchUpOperator(deps(WEDNESDAY_3RD), actor.operatorId, LONG_AGO);
    const second = await catchUpOperator(deps(WEDNESDAY_3RD), actor.operatorId, LONG_AGO);

    expect(failed).toBeInstanceOf(Error);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    const documents = await documentsOf(rentalId);
    expect(documents).toEqual([["invoice", `INV-${before}`, 350_00]]);
  });

  it("issues a statement with the balance before, through and after the days asked", async () => {
    const rentalId = await rentalCharged();
    await recordPayment(web.db, actor, rentalId, {
      amountCents: 100_00,
      method: "cash",
      reference: null,
      occurredOn: "2030-04-05",
    });
    await issuePendingDocuments(deps(WEDNESDAY_3RD), actor, rentalId);
    sentEmails.length = 0;

    const statement = await issueStatement(deps(WEDNESDAY_3RD), actor, rentalId, {
      fromDate: "2030-04-04",
      toDate: "2030-04-30",
    });
    const issuedDocumentId = statement.status === "issued" ? statement.issuedDocumentId : "";
    const emailed = await emailBillingDocumentAgain(deps(WEDNESDAY_3RD), actor.operatorId, {
      rentalId,
      issuedDocumentId,
    });

    expect(statement.status).toBe("issued");
    expect(emailed).toBe("sent");
    expect(sentEmails[0]?.subject).toBe("Statement from Invoice Rentals Pty Ltd");
    // The test clock gives each the same time, so the order is not checked here.
    expect((await documentsOf(rentalId)).map(([kind]) => kind).sort()).toEqual([
      "invoice",
      "receipt",
      "statement",
    ]);
  });

  it("sets the numbering until the first document, then only the prefix", async () => {
    const newOperator = await seedOperatorWithUser(admin, "Numbering Rentals Pty Ltd");
    const set = await saveNumbering(web.db, newOperator, "invoice", {
      prefix: "SC-",
      nextNumber: 5000,
    });
    const newKit = checklistKit(web, storage, sentEmails, newOperator);
    const { rentalId } = await newKit.rentalOut(HANDOVER_TUESDAY);
    await chargeRentFor(web.db, newOperator.operatorId, WEDNESDAY_3RD, [rentalId]);
    const [invoice] = await issuePendingDocuments(deps(WEDNESDAY_3RD), newOperator, rentalId);

    const moved = await saveNumbering(web.db, newOperator, "invoice", {
      prefix: "SC-",
      nextNumber: 9000,
    });
    const renamed = await saveNumbering(web.db, newOperator, "invoice", {
      prefix: "SAM-",
      nextNumber: 5001,
    });

    expect([set, moved, renamed]).toEqual(["saved", "started", "saved"]);
    expect(invoice!.numberText).toBe("SC-5000");
    expect((await loadNumbering(web.db, newOperator.operatorId))[0]).toMatchObject({
      prefix: "SAM-",
      nextNumber: 5001,
      isStarted: true,
    });
    // An invoice already issued keeps the number it was printed with.
    expect(await listBillingDocuments(web.db, newOperator.operatorId, rentalId)).toMatchObject([
      { numberText: "SC-5000" },
    ]);
  });

  it("keeps each business's documents to itself", async () => {
    const rentalId = await rentalCharged();
    await issuePendingDocuments(deps(WEDNESDAY_3RD), actor, rentalId);
    const [ours] = await listBillingDocuments(web.db, actor.operatorId, rentalId);

    const intoA = await issuePendingDocuments(deps(WEDNESDAY_3RD), otherOperator, rentalId, {
      isInvoicedNow: true,
    });
    const listed = await listBillingDocuments(web.db, otherOperator.operatorId, rentalId);
    const opened = await loadBillingDocumentPdf(deps(WEDNESDAY_3RD), otherOperator.operatorId, {
      rentalId,
      issuedDocumentId: ours!.issuedDocumentId,
    });
    const statement = await issueStatement(deps(WEDNESDAY_3RD), otherOperator, rentalId, {
      fromDate: "2030-04-01",
      toDate: "2030-04-30",
    });

    expect(intoA).toEqual([]);
    expect(listed).toEqual([]);
    expect(opened).toBeNull();
    expect(statement).toEqual({ status: "not_found" });
  });
});
