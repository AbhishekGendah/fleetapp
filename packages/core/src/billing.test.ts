import { describe, expect, it } from "vitest";

import {
  billingDocumentTitle,
  documentNumberText,
  documentTotals,
  gstMarking,
  hasPendingDocuments,
  isOneOffCharge,
  isTaxDocumentOn,
  pendingDocuments,
  type BillableLine,
} from "./billing";

function billable(
  id: string,
  kind: BillableLine["kind"],
  extra: Partial<BillableLine> = {},
): BillableLine {
  return { id, kind, reversesId: null, periodStart: null, documentId: null, ...extra };
}

const RENT = billable("rent", "charge", { periodStart: "2026-11-03" });
const CLEANING = billable("cleaning", "charge");
const PAYMENT = billable("payment", "payment");

describe("document numbers and titles", () => {
  it("prints the prefix and the number", () => {
    expect(documentNumberText({ prefix: "INV-", nextNumber: 1001 })).toBe("INV-1001");
    expect(documentNumberText({ prefix: "", nextNumber: 7 })).toBe("7");
  });

  it("is a tax invoice or adjustment note only while GST-registered on the day", () => {
    expect(isTaxDocumentOn("2026-07-01", "2026-11-03")).toBe(true);
    expect(isTaxDocumentOn("2026-12-01", "2026-11-03")).toBe(false);
    expect(isTaxDocumentOn(null, "2026-11-03")).toBe(false);
    expect(billingDocumentTitle("invoice", true)).toBe("Tax invoice");
    expect(billingDocumentTitle("invoice", false)).toBe("Invoice");
    expect(billingDocumentTitle("credit_note", true)).toBe("Adjustment note");
    expect(billingDocumentTitle("credit_note", false)).toBe("Credit note");
    expect(billingDocumentTitle("receipt", true)).toBe("Receipt");
  });

  it("marks how far each line is taxable", () => {
    expect(gstMarking(31_82, "taxable")).toBe("Includes GST");
    expect(gstMarking(0, "gst_free")).toBe("GST-free");
    expect(gstMarking(0, "no_gst")).toBe("No GST");
    expect(gstMarking(0, "taxable")).toBe("No GST");
  });

  it("adds a document's lines and their stored GST, to the cent", () => {
    expect(
      documentTotals([
        { amountCents: 350_00, gstCents: 31_82 },
        { amountCents: 80_05, gstCents: 7_28 },
        { amountCents: 12_00, gstCents: 0 },
      ]),
    ).toEqual({ amountCents: 442_05, gstCents: 39_10 });
    expect(documentTotals([])).toEqual({ amountCents: 0, gstCents: 0 });
  });
});

describe("what still needs a document", () => {
  it("invoices rent first, then each one-off charge on its own, and each payment on a receipt", () => {
    const pending = pendingDocuments([CLEANING, RENT, PAYMENT]);

    expect(pending.invoiceLineIds).toEqual(["rent"]);
    expect(pending.receiptLineIds).toEqual(["payment"]);
    expect(pending.creditNotes).toEqual([]);
    const afterRent = pendingDocuments([CLEANING, { ...RENT, documentId: "inv-1" }]);
    expect(afterRent.invoiceLineIds).toEqual(["cleaning"]);
  });

  it("never holds a one-off charge back, and puts two waiting on an invoice each", () => {
    const towing = billable("towing", "charge");
    expect(pendingDocuments([CLEANING]).invoiceLineIds).toEqual(["cleaning"]);
    expect(pendingDocuments([CLEANING, towing]).invoiceLineIds).toEqual(["cleaning"]);
    expect(pendingDocuments([{ ...CLEANING, documentId: "inv-1" }, towing]).invoiceLineIds).toEqual(
      ["towing"],
    );
  });

  it("tells a one-off charge from rent and its corrections", () => {
    expect(isOneOffCharge(CLEANING)).toBe(true);
    expect(isOneOffCharge(RENT)).toBe(false);
    expect(isOneOffCharge(PAYMENT)).toBe(false);
  });

  it("needs nothing for lines already on a document", () => {
    const pending = pendingDocuments([
      { ...RENT, documentId: "inv-1" },
      { ...PAYMENT, documentId: "rct-1" },
    ]);
    expect(hasPendingDocuments(pending)).toBe(false);
  });

  it("needs nothing for a charge reversed before it was invoiced, nor for its reversal", () => {
    const pending = pendingDocuments([
      CLEANING,
      billable("undo", "reversal", { reversesId: "cleaning" }),
    ]);
    expect(hasPendingDocuments(pending)).toBe(false);
  });

  it("corrects an invoiced charge with a credit note naming its invoice", () => {
    const pending = pendingDocuments([
      { ...CLEANING, documentId: "inv-1" },
      billable("undo", "reversal", { reversesId: "cleaning" }),
    ]);
    expect(pending.creditNotes).toEqual([{ relatesToDocumentId: "inv-1", lineIds: ["undo"] }]);
  });

  it("credits unused days against the invoice with that period's rent", () => {
    const pending = pendingDocuments([
      { ...RENT, documentId: "inv-2" },
      billable("unused", "credit", { periodStart: "2026-11-03" }),
    ]);
    expect(pending.creditNotes).toEqual([{ relatesToDocumentId: "inv-2", lineIds: ["unused"] }]);
  });

  it("makes one credit note per invoice corrected", () => {
    const pending = pendingDocuments([
      { ...RENT, documentId: "inv-1" },
      { ...CLEANING, documentId: "inv-2" },
      billable("unused", "credit", { periodStart: "2026-11-03" }),
      billable("undo", "reversal", { reversesId: "cleaning" }),
    ]);
    expect(pending.creditNotes).toEqual([
      { relatesToDocumentId: "inv-1", lineIds: ["unused"] },
      { relatesToDocumentId: "inv-2", lineIds: ["undo"] },
    ]);
  });

  it("keeps a reversed payment's receipt and makes no document for the reversal", () => {
    const pending = pendingDocuments([
      { ...PAYMENT, documentId: "rct-1" },
      billable("undo", "reversal", { reversesId: "payment" }),
    ]);
    expect(hasPendingDocuments(pending)).toBe(false);
  });

  it("invoices a block-rent correction at once and credits against its period's invoice", () => {
    const weekStart = "2026-11-26T23:00:00.000Z";
    const pending = pendingDocuments([
      billable("week", "charge", { periodStart: weekStart, documentId: "inv-4" }),
      billable("repriced", "charge", { periodStart: weekStart, isCorrection: true }),
      billable("unused", "credit", { periodStart: weekStart, isCorrection: true }),
    ]);
    expect(pending.invoiceLineIds).toEqual(["repriced"]);
    expect(pending.creditNotes).toEqual([{ relatesToDocumentId: "inv-4", lineIds: ["unused"] }]);
  });

  it("puts taking back a credit already on a credit note on an invoice (review A4-7)", () => {
    const credited = billable("unused", "credit", {
      periodStart: "2026-11-03",
      documentId: "cn-1",
    });
    const pending = pendingDocuments([
      { ...RENT, documentId: "inv-1" },
      credited,
      billable("undo", "reversal", { reversesId: "unused" }),
    ]);
    expect(pending.invoiceLineIds).toEqual(["undo"]);
    expect(pending.creditNotes).toEqual([]);
  });

  it("gives no document for a credit reversed before its credit note", () => {
    const pending = pendingDocuments([
      { ...RENT, documentId: "inv-1" },
      billable("unused", "credit", { periodStart: "2026-11-03" }),
      billable("undo", "reversal", { reversesId: "unused" }),
    ]);
    expect(hasPendingDocuments(pending)).toBe(false);
  });

  it("gives no receipt for a payment reversed before its receipt", () => {
    const pending = pendingDocuments([
      PAYMENT,
      billable("undo", "reversal", { reversesId: "payment" }),
    ]);
    expect(pending.receiptLineIds).toEqual([]);
  });
});
