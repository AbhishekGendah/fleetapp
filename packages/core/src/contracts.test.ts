import { describe, expect, it } from "vitest";

import {
  fillMergeFields,
  MERGE_FIELDS,
  mergeFieldsUsed,
  missingMergeFields,
  contractKindFor,
  isRentalContractKind,
  missingRentTermFields,
  STARTER_BUSINESS_CONTRACT,
  STARTER_CHANGE_OF_TERMS,
  STARTER_CONTRACT,
  STARTER_SWAP_FORM,
  MAXIMUM_LIST_NESTING,
  TEMPLATE_TOO_NESTED_MESSAGE,
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
    expect(templateDocumentSchema.safeParse(STARTER_SWAP_FORM).success).toBe(true);
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

describe("a template's lists inside lists", () => {
  /** A document with lists nested `depth` deep, one item each. */
  function nested(depth: number): unknown {
    let block: unknown = { type: "paragraph", content: [{ type: "text", text: "Deepest" }] };
    for (let level = 0; level < depth; level += 1) {
      block = { type: "bulletList", content: [{ type: "listItem", content: [block] }] };
    }
    return { type: "doc", content: [block] };
  }

  it("takes a contract's usual few levels", () => {
    expect(templateDocumentSchema.safeParse(nested(5)).success).toBe(true);
  });

  it("refuses deeper than the limit with a clear message, before checking the rest (review G5-3)", () => {
    const tooDeep = templateDocumentSchema.safeParse(nested(MAXIMUM_LIST_NESTING + 1));
    expect(tooDeep.success).toBe(false);
    expect(tooDeep.error?.issues[0]?.message).toBe(TEMPLATE_TOO_NESTED_MESSAGE);
    // Hundreds deep, as a doctored request would send: refused the same way, quickly.
    expect(templateDocumentSchema.safeParse(nested(500)).error?.issues[0]?.message).toBe(
      TEMPLATE_TOO_NESTED_MESSAGE,
    );
  });
});

describe("the business rental contract (decision 10)", () => {
  it("is a valid template with the rent terms, naming the business and never a person's details", () => {
    const used = mergeFieldsUsed(STARTER_BUSINESS_CONTRACT);

    expect(templateDocumentSchema.safeParse(STARTER_BUSINESS_CONTRACT).success).toBe(true);
    expect(missingRentTermFields(STARTER_BUSINESS_CONTRACT)).toEqual([]);
    expect(used).toEqual(
      expect.arrayContaining([
        "renterLegalName",
        "renterAbn",
        "renterBusinessAddress",
        "renterContactName",
      ]),
    );
    for (const personal of [
      "renterFullName",
      "renterDateOfBirth",
      "renterAddress",
      "renterLicenceNumber",
      "renterLicenceIssuedIn",
      "renterLicenceExpires",
    ] as const) {
      expect(used).not.toContain(personal);
    }
  });

  it("leaves a person's starter contract as it was", () => {
    expect(mergeFieldsUsed(STARTER_CONTRACT)).toContain("renterDateOfBirth");
    expect(mergeFieldsUsed(STARTER_CONTRACT)).not.toContain("renterAbn");
  });

  it("is the kind a business's rentals are signed under; a person's stays the rental contract", () => {
    expect(contractKindFor("organisation")).toBe("business_contract");
    expect(contractKindFor("person")).toBe("contract");
    expect(isRentalContractKind("business_contract")).toBe(true);
    expect(isRentalContractKind("change_of_terms")).toBe(false);
  });
});
