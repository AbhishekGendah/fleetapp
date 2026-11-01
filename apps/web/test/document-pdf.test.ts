import { STARTER_CONTRACT, MERGE_FIELDS, fillMergeFields, type ContractData } from "@fleetapp/core";
import { describe, expect, it } from "vitest";

import { renderDocumentPdf } from "../src/lib/contracts/document-pdf";

const PDF_START = "%PDF-";

describe("document PDFs", () => {
  it("makes a PDF of the filled-in starter contract", async () => {
    const data = Object.fromEntries(
      MERGE_FIELDS.map((field) => [field.key, `Example ${field.label}`]),
    ) as ContractData;

    const bytes = await renderDocumentPdf({
      title: "Rental contract",
      businessName: "Example Rentals Pty Ltd",
      document: fillMergeFields(STARTER_CONTRACT, data),
      notice: "Preview: not issued",
    });

    expect(new TextDecoder().decode(bytes.slice(0, PDF_START.length))).toBe(PDF_START);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
