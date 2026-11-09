import {
  businessStatementFigures,
  type TemplateBlock,
  type TemplateDocument,
} from "@fleetapp/core";
import { describe, expect, it } from "vitest";

import { billedToBlocks, billedToOf, type BilledTo } from "../src/lib/billing/billed-to";
import { itemDocumentPdfInput, type BillingPdfParties } from "../src/lib/billing/billing-pdf";
import { businessStatementPdfInput } from "../src/lib/billing/business-statement-pdf";
import { statementCarsOf } from "../src/lib/billing/business-statements";
import type { DocumentPdfInput } from "../src/lib/contracts/document-pdf";
import type { LedgerLineView } from "../src/lib/ledger/ledger-queries";
import type { BusinessDetails } from "../src/lib/settings/business-details";

const OPERATOR: BusinessDetails = {
  legalName: "Sam's Car Rentals Pty Ltd",
  tradingName: null,
  abn: "53021487618",
  gstRegistered: true,
  gstRegisteredFrom: "2020-01-01",
  addressLine1: "88 Example Highway",
  addressLine2: null,
  suburb: "Welshpool",
  state: "WA",
  postcode: "6106",
  phone: null,
  email: null,
  privacyPolicyUrl: null,
  timezone: "Australia/Perth",
};
const ACME: BilledTo = billedToOf({
  kind: "organisation",
  fullName: "Acme Rideshare Pty Ltd",
  tradingName: "Acme Rides",
  abn: "51824753556",
  contactName: "Dana Wells",
  businessAddress: "Unit 4, 12 Example Road, Osborne Park WA 6017",
  postalAddress: "PO Box 1234, Osborne Park WA 6917",
});
const SAM_ID = "11111111-1111-4111-8111-111111111111";
const DRIVERS = new Map([[SAM_ID, "Sam Lee"]]);

function ledgerLine(changes: Partial<LedgerLineView>): LedgerLineView {
  return {
    id: "line-1",
    rentalId: "rental-1",
    rego: "1BRT482",
    driverId: SAM_ID,
    kind: "charge",
    chargeTypeLabel: "Weekly rent",
    amountCents: 380_00,
    gstCents: 34_55,
    description: "Rent, 2 to 9 Nov",
    effectiveOn: "2026-11-02",
    method: null,
    reference: null,
    reversesId: null,
    periodStart: "2026-11-02",
    isCorrection: false,
    gstTreatment: "taxable",
    documentId: null,
    documentNumberText: null,
    isFromStripe: false,
    createdAt: new Date("2026-11-02T00:00:00Z"),
    ...changes,
  };
}

function parties(billedTo: BilledTo): BillingPdfParties {
  return {
    business: OPERATOR,
    branding: { businessName: OPERATOR.legalName ?? "" },
    billedTo,
    rentalSummary: "1BRT482 Toyota Camry Hybrid",
    driverNames: DRIVERS,
  };
}

/** Every piece of text a block holds, in order. */
function blockTexts(blocks: readonly TemplateBlock[]): string[] {
  return blocks.map((block) =>
    "content" in block && Array.isArray(block.content)
      ? block.content.map((inline) => ("text" in inline ? inline.text : "")).join("")
      : "",
  );
}

function documentTexts(document: TemplateDocument | undefined): string[] {
  return document ? blockTexts(document.content) : [];
}

function invoiceFor(billedTo: BilledTo, lines: readonly LedgerLineView[]): DocumentPdfInput {
  return itemDocumentPdfInput({
    parties: parties(billedTo),
    header: { title: "Tax invoice", numberText: "INV-1067", issuedOn: "2026-11-02" },
    lines,
    allLines: lines,
    isTaxDocument: true,
    isReduction: false,
    howToPay: "",
  });
}

describe("who a money document is addressed to", () => {
  it("names a business by its legal name, trading name, ABN, contact and postal address", () => {
    expect(blockTexts(billedToBlocks(ACME))).toEqual([
      "Acme Rideshare Pty Ltd",
      "Trading as Acme Rides",
      "ABN: 51 824 753 556",
      "Attention: Dana Wells",
      "PO Box 1234, Osborne Park WA 6917",
    ]);
  });

  it("names a person by their name only, and their ABN when they gave one, never their address", () => {
    const person = {
      kind: "person" as const,
      fullName: "Ella Sole",
      tradingName: null,
      contactName: null,
      businessAddress: null,
      postalAddress: "1 Home Street, Perth WA 6000",
    };

    expect(blockTexts(billedToBlocks(billedToOf({ ...person, abn: null })))).toEqual(["Ella Sole"]);
    expect(blockTexts(billedToBlocks(billedToOf({ ...person, abn: "51824753556" })))).toEqual([
      "Ella Sole",
      "ABN: 51 824 753 556",
    ]);
  });
});

describe("a business's invoice", () => {
  it("names each line's car and who drove it, beside the business it is addressed to", () => {
    const invoice = invoiceFor(ACME, [ledgerLine({})]);

    expect(documentTexts(invoice.document)).toEqual(
      expect.arrayContaining(["To", "Acme Rideshare Pty Ltd", "ABN: 51 824 753 556"]),
    );
    expect(invoice.table?.rows[0]?.[1]).toBe(
      "Weekly rent: Rent, 2 to 9 Nov (1BRT482, driver Sam Lee)",
    );
  });

  it("leaves a person's lines as they were, naming no driver", () => {
    const person = billedToOf({
      kind: "person",
      fullName: "Sam Example",
      tradingName: null,
      abn: null,
      contactName: null,
      businessAddress: null,
      postalAddress: null,
    });

    expect(invoiceFor(person, [ledgerLine({})]).table?.rows[0]?.[1]).toBe(
      "Weekly rent: Rent, 2 to 9 Nov",
    );
  });
});

describe("a business's statement across its cars", () => {
  const lines = [
    ledgerLine({ id: "c1", documentNumberText: "INV-1067" }),
    ledgerLine({ id: "p1", kind: "payment", chargeTypeLabel: null, amountCents: 200_00 }),
    ledgerLine({
      id: "k1",
      rentalId: "rental-2",
      rego: "6VWX345",
      driverId: null,
      amountCents: 360_00,
      effectiveOn: "2026-11-03",
    }),
  ];
  const input = businessStatementPdfInput({
    parties: { business: OPERATOR, branding: { businessName: "Sam's" }, billedTo: ACME },
    issuedOn: "2026-11-08",
    fromDate: "2026-11-01",
    toDate: "2026-11-08",
    figures: businessStatementFigures(lines, "2026-11-01", "2026-11-08"),
    cars: new Map([
      [
        "rental-1",
        { rentalId: "rental-1", carText: "1BRT482 · Toyota Camry", driverNames: ["Sam Lee"] },
      ],
      ["rental-2", { rentalId: "rental-2", carText: "6VWX345 · Kia Cerato", driverNames: [] }],
    ]),
    bonds: { heldCents: 1_000_00, rentalCount: 2 },
    howToPay: "BSB 000-000, account 1234 5678",
  });

  it("is to the business, not a tax invoice, with its totals across all cars", () => {
    const texts = documentTexts(input.document);

    expect(texts).toEqual(
      expect.arrayContaining([
        "Acme Rideshare Pty Ltd",
        "This is a statement, not a tax invoice.",
        "Charged: $740.00",
        "Paid: $200.00",
        "Balance: Owing $540.00",
      ]),
    );
    expect(documentTexts(input.closing)).toEqual(
      expect.arrayContaining([
        "BSB 000-000, account 1234 5678",
        "Bonds are held separately and are not included: $1,000.00 held across 2 rentals.",
      ]),
    );
  });

  it("groups the lines by car, each headed by its driver, with its own subtotal", () => {
    expect(input.tables?.map((table) => table.heading)).toEqual([
      "1BRT482 · Toyota Camry · driver Sam Lee",
      "6VWX345 · Kia Cerato · driver to be named",
    ]);
    expect(input.tables?.[0]?.rows).toEqual([
      ["2 Nov 2026", "Weekly rent: Rent, 2 to 9 Nov", "INV-1067", "$380.00", ""],
      ["2 Nov 2026", "Rent, 2 to 9 Nov", "", "", "$200.00"],
    ]);
    expect(input.tables?.[0]?.totals).toEqual([
      ["Charged on 1BRT482", "$380.00"],
      ["Paid on 1BRT482", "$200.00"],
      ["Balance on 1BRT482", "Owing $180.00"],
    ]);
  });
});

describe("a statement's car headings (review)", () => {
  const MIA_ID = "22222222-2222-4222-8222-222222222222";
  const names = new Map([
    [SAM_ID, "Sam Lee"],
    [MIA_ID, "Mia Thompson"],
  ]);
  const rental = {
    id: "rental-1",
    driverId: MIA_ID,
    rego: "2NEW222",
    make: "Kia",
    model: "Cerato",
  };
  // Sam had 1BRT482 in October; after a swap and a driver change, Mia has 2NEW222.
  const lines = [
    ledgerLine({ id: "old", effectiveOn: "2026-10-05", rego: "1BRT482", driverId: SAM_ID }),
    ledgerLine({ id: "new", effectiveOn: "2026-11-02", rego: "2NEW222", driverId: MIA_ID }),
  ];

  function headingFor(fromDate: string): unknown {
    const figures = businessStatementFigures(lines, fromDate, "2026-11-30");
    return statementCarsOf([rental], figures, names).get("rental-1");
  }

  it("names only the car and driver of the lines in the days asked", () => {
    expect(headingFor("2026-11-01")).toEqual({
      rentalId: "rental-1",
      carText: "2NEW222 · Kia Cerato",
      driverNames: ["Mia Thompson"],
    });
    expect(headingFor("2026-10-01")).toMatchObject({
      carText: "1BRT482 then 2NEW222 · Kia Cerato",
      driverNames: ["Sam Lee", "Mia Thompson"],
    });
  });

  it("names the car and driver now when only a balance is brought forward", () => {
    const figures = businessStatementFigures(lines, "2026-11-10", "2026-11-30");

    expect(statementCarsOf([rental], figures, names).get("rental-1")).toMatchObject({
      carText: "2NEW222 · Kia Cerato",
      driverNames: ["Mia Thompson"],
    });
  });
});
