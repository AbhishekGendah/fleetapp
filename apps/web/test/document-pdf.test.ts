import { inflateSync } from "node:zlib";

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

/** Every text the PDF's fonts say they print, read from their character maps (ToUnicode). */
function printedCharacters(pdf: Uint8Array): Set<string> {
  const raw = Buffer.from(pdf).toString("latin1");
  const characters = new Set<string>();
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let text: string;
    try {
      text = inflateSync(Buffer.from(match[1] ?? "", "latin1")).toString("latin1");
    } catch {
      continue; // Not a compressed stream (a picture, say): it holds no character map.
    }
    if (!text.includes("begincmap")) {
      continue;
    }
    for (const hex of text.matchAll(/<([0-9a-fA-F]{4,})>\s*<([0-9a-fA-F]{4})>/g)) {
      characters.add(String.fromCodePoint(Number.parseInt(hex[2] ?? "0", 16)));
    }
  }
  return characters;
}

describe("names in any European alphabet (review A3-4)", () => {
  it("prints every letter of the name, with the font embedded", async () => {
    const name = "Łukasz Wójcik, Ștefan Kőváry";
    const bytes = await renderDocumentPdf({
      title: "Rental contract",
      businessName: "Example Rentals Pty Ltd",
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: name }] }],
      },
      signature: { signedByText: `Signed by ${name}`, signedAtText: "Now", typedName: name },
    });

    const printed = printedCharacters(bytes);
    for (const letter of ["Ł", "ó", "Ș", "ő", "á"]) {
      expect(printed.has(letter)).toBe(true);
    }
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans/);
    expect(raw).not.toContain("/Helvetica");
  });
});
