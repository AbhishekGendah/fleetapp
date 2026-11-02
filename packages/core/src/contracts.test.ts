import { describe, expect, it } from "vitest";

import {
  fillMergeFields,
  MERGE_FIELDS,
  mergeFieldsUsed,
  missingMergeFields,
  STARTER_CHANGE_OF_TERMS,
  STARTER_CONTRACT,
  templateDocumentSchema,
  type ContractData,
  type TemplateDocument,
} from "./contracts";
import { documentFingerprint, DOCUMENT_FINGERPRINT_PATTERN } from "./document-fingerprint";

const ALL_EMPTY = Object.fromEntries(
  MERGE_FIELDS.map((field) => [field.key, null]),
) as ContractData;

const ONE_PARAGRAPH: TemplateDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Rego: ", marks: [{ type: "bold" }] },
        { type: "mergeField", attrs: { key: "carRego" } },
        { type: "hardBreak" },
        { type: "mergeField", attrs: { key: "renterLicenceNumber" } },
      ],
    },
  ],
};

describe("contract templates", () => {
  it("accepts the starter contract and every field in the menu is unique", () => {
    expect(templateDocumentSchema.safeParse(STARTER_CONTRACT).success).toBe(true);
    expect(templateDocumentSchema.safeParse(STARTER_CHANGE_OF_TERMS).success).toBe(true);
    expect(mergeFieldsUsed(STARTER_CHANGE_OF_TERMS)).toEqual(
      expect.arrayContaining(["changeSummary", "changeReason"]),
    );
    const keys = MERGE_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("refuses what a contract cannot print: links, pictures, code, unknown fields", () => {
    const withNode = (node: unknown) => ({ type: "doc", content: [node] });
    const refused = [
      withNode({ type: "image", attrs: { src: "https://example.test/x.png" } }),
      withNode({ type: "codeBlock", content: [{ type: "text", text: "x" }] }),
      withNode({
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "x" } }] }],
      }),
      withNode({
        type: "paragraph",
        content: [{ type: "mergeField", attrs: { key: "password" } }],
      }),
      withNode({ type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "x" }] }),
      { type: "doc", content: [] },
    ];
    expect(refused.map((document) => templateDocumentSchema.safeParse(document).success)).toEqual(
      refused.map(() => false),
    );
  });

  it("fills each field with its value, marks the gaps, and leaves the template as it was", () => {
    const before = structuredClone(ONE_PARAGRAPH);
    const filled = fillMergeFields(ONE_PARAGRAPH, { ...ALL_EMPTY, carRego: "1ABC234" });

    expect(filled.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "Rego: ", marks: [{ type: "bold" }] },
        { type: "text", text: "1ABC234" },
        { type: "hardBreak" },
        { type: "text", text: "[Licence number: not on file]" },
      ],
    });
    expect(ONE_PARAGRAPH).toEqual(before);
  });

  it("lists the fields a template uses, and which have nothing on file, including inside lists", () => {
    expect(mergeFieldsUsed(ONE_PARAGRAPH)).toEqual(["carRego", "renterLicenceNumber"]);
    expect(missingMergeFields(ONE_PARAGRAPH, { ...ALL_EMPTY, carRego: "1ABC234" })).toEqual([
      "renterLicenceNumber",
    ]);
    expect(mergeFieldsUsed(STARTER_CONTRACT)).toContain("weeklyRate");
  });
});

describe("document fingerprints", () => {
  it("is SHA-256 in hex, and changes with a single byte", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 example");
    const changed = new TextEncoder().encode("%PDF-1.7 exampla");

    expect(documentFingerprint(bytes)).toMatch(DOCUMENT_FINGERPRINT_PATTERN);
    expect(documentFingerprint(bytes)).not.toBe(documentFingerprint(changed));
    expect(documentFingerprint(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
