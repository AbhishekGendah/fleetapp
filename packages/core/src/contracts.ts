import { z } from "zod";

/**
 * Contract templates (docs/design/05): the Operator writes the text, with
 * merge fields the app fills in for each rental. AGS supplies the layout,
 * never legal wording.
 */

export const CONTRACT_TEMPLATE_KINDS = ["contract", "swap_form", "change_of_terms"] as const;
export type ContractTemplateKind = (typeof CONTRACT_TEMPLATE_KINDS)[number];

export const CONTRACT_TEMPLATE_KIND_LABELS: Readonly<Record<ContractTemplateKind, string>> = {
  contract: "Rental contract",
  swap_form: "Car swap form",
  change_of_terms: "Change of terms",
};

/** Fixed documents issued for a rental (rule 12): kept as a PDF with its fingerprint, never changed. */
export const ISSUED_DOCUMENT_KINDS = [
  "contract",
  "handover_report",
  "return_report",
  "swap_form",
  "change_of_terms",
] as const;
export type IssuedDocumentKind = (typeof ISSUED_DOCUMENT_KINDS)[number];

export const MERGE_FIELD_GROUPS = ["business", "renter", "car", "rental", "change"] as const;
export type MergeFieldGroup = (typeof MERGE_FIELD_GROUPS)[number];

export const MERGE_FIELD_GROUP_LABELS: Readonly<Record<MergeFieldGroup, string>> = {
  business: "Your business",
  renter: "Renter",
  car: "Car",
  rental: "Rental",
  change: "Change of terms (filled in only on that form)",
};

/**
 * Every field a template can insert, in the order the "Insert field" menu
 * lists them. A fine admin fee is added with fines (Phase 6).
 */
export const MERGE_FIELDS = [
  { key: "businessLegalName", label: "Business legal name", group: "business" },
  { key: "businessTradingName", label: "Trading name", group: "business" },
  { key: "businessAbn", label: "ABN", group: "business" },
  { key: "businessAddress", label: "Business address", group: "business" },
  { key: "businessPhone", label: "Business phone", group: "business" },
  { key: "businessEmail", label: "Business email", group: "business" },
  { key: "renterFullName", label: "Renter's full name", group: "renter" },
  { key: "renterDateOfBirth", label: "Renter's date of birth", group: "renter" },
  { key: "renterAddress", label: "Renter's home address", group: "renter" },
  { key: "renterPhone", label: "Renter's phone", group: "renter" },
  { key: "renterEmail", label: "Renter's email", group: "renter" },
  { key: "renterLicenceNumber", label: "Licence number", group: "renter" },
  { key: "renterLicenceIssuedIn", label: "Licence issued in", group: "renter" },
  { key: "renterLicenceExpires", label: "Licence expiry", group: "renter" },
  { key: "carRego", label: "Rego", group: "car" },
  { key: "carMakeModel", label: "Make and model", group: "car" },
  { key: "carYear", label: "Year", group: "car" },
  { key: "carVin", label: "VIN", group: "car" },
  { key: "insuranceExcess", label: "Insurance excess", group: "car" },
  { key: "rentalKind", label: "Kind of rental", group: "rental" },
  { key: "rentalStart", label: "Start", group: "rental" },
  { key: "rentalEnd", label: "End", group: "rental" },
  { key: "weeklyRate", label: "Weekly rate", group: "rental" },
  { key: "bond", label: "Bond", group: "rental" },
  { key: "chargeDay", label: "Rent charged each", group: "rental" },
  { key: "noticeDays", label: "Notice to end an ongoing rental", group: "rental" },
  { key: "issuedOn", label: "Date of issue", group: "rental" },
  { key: "changeSummary", label: "What is changing", group: "change" },
  { key: "changeReason", label: "Why", group: "change" },
  { key: "changeNewRate", label: "New weekly rate", group: "change" },
  { key: "changeRateFrom", label: "New rate applies from", group: "change" },
  { key: "changeNewEnd", label: "New end", group: "change" },
] as const satisfies readonly { key: string; label: string; group: MergeFieldGroup }[];

export type MergeFieldKey = (typeof MERGE_FIELDS)[number]["key"];
const MERGE_FIELD_KEYS = MERGE_FIELDS.map((field) => field.key) as [
  MergeFieldKey,
  ...MergeFieldKey[],
];

export function mergeFieldLabel(key: MergeFieldKey): string {
  return MERGE_FIELDS.find((field) => field.key === key)?.label ?? key;
}

/** Each field's value for one rental, already in words; null when not on file. */
export type ContractData = Readonly<Record<MergeFieldKey, string | null>>;

/** The most text one template may hold, so a document stays a sensible size. */
export const MAXIMUM_TEMPLATE_CHARACTERS = 100_000;
/** Headings go three deep: a title, sections and sub-sections. */
const HEADING_LEVELS = [1, 2, 3] as const;
export const TEMPLATE_TEXT_MARKS = ["bold", "italic", "underline"] as const;

const markSchema = z.object({ type: z.enum(TEMPLATE_TEXT_MARKS) }).strict();

const textSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1),
    marks: z.array(markSchema).optional(),
  })
  .strict();
const hardBreakSchema = z.object({ type: z.literal("hardBreak") }).strict();
const mergeFieldSchema = z
  .object({ type: z.literal("mergeField"), attrs: z.object({ key: z.enum(MERGE_FIELD_KEYS) }) })
  .strict();
const inlineSchema = z.discriminatedUnion("type", [textSchema, hardBreakSchema, mergeFieldSchema]);
export type TemplateInline = z.infer<typeof inlineSchema>;

const paragraphSchema = z
  .object({ type: z.literal("paragraph"), content: z.array(inlineSchema).optional() })
  .strict();
const headingSchema = z
  .object({
    type: z.literal("heading"),
    attrs: z.object({ level: z.union(HEADING_LEVELS.map((level) => z.literal(level))) }),
    content: z.array(inlineSchema).optional(),
  })
  .strict();
const horizontalRuleSchema = z.object({ type: z.literal("horizontalRule") }).strict();

export type TemplateBlock =
  | z.infer<typeof paragraphSchema>
  | z.infer<typeof headingSchema>
  | z.infer<typeof horizontalRuleSchema>
  | { type: "bulletList" | "orderedList"; content: TemplateListItem[]; attrs?: { start?: number } }
  | TemplateListItem;
export interface TemplateListItem {
  type: "listItem";
  content: TemplateBlock[];
}

const blockSchema: z.ZodType<TemplateBlock> = z.lazy(() =>
  z.union([paragraphSchema, headingSchema, horizontalRuleSchema, listSchema]),
);
const listItemSchema: z.ZodType<TemplateListItem> = z.lazy(() =>
  z.object({ type: z.literal("listItem"), content: z.array(blockSchema).min(1) }).strict(),
);
const listSchema = z
  .object({
    type: z.enum(["bulletList", "orderedList"]),
    attrs: z.object({ start: z.number().int().positive().optional() }).optional(),
    content: z.array(listItemSchema).min(1),
  })
  .strict();

/**
 * What a template may hold: the editor's own document format (TipTap's
 * JSON), but only headings, paragraphs, lists, a dividing line, bold,
 * italic, underline and merge fields. Anything else (links, pictures,
 * code) is refused, so a template can only ever print as text.
 */
export const templateDocumentSchema = z
  .object({ type: z.literal("doc"), content: z.array(blockSchema).min(1) })
  .strict()
  .refine(
    (document) => JSON.stringify(document).length <= MAXIMUM_TEMPLATE_CHARACTERS,
    `A template can hold at most ${MAXIMUM_TEMPLATE_CHARACTERS.toLocaleString("en-AU")} characters.`,
  );
export type TemplateDocument = z.infer<typeof templateDocumentSchema>;

function mapInlines(
  inlines: readonly TemplateInline[] | undefined,
  fill: (key: MergeFieldKey) => TemplateInline,
): TemplateInline[] | undefined {
  return inlines?.map((inline) => (inline.type === "mergeField" ? fill(inline.attrs.key) : inline));
}

function mapBlock(
  block: TemplateBlock,
  fill: (key: MergeFieldKey) => TemplateInline,
): TemplateBlock {
  switch (block.type) {
    case "paragraph":
    case "heading": {
      const content = mapInlines(block.content, fill);
      return content ? { ...block, content } : { ...block };
    }
    case "bulletList":
    case "orderedList":
      return { ...block, content: block.content.map((item) => mapListItem(item, fill)) };
    case "listItem":
      return mapListItem(block, fill);
    case "horizontalRule":
      return { ...block };
  }
}

function mapListItem(
  item: TemplateListItem,
  fill: (key: MergeFieldKey) => TemplateInline,
): TemplateListItem {
  return { ...item, content: item.content.map((block) => mapBlock(block, fill)) };
}

/** Shown where a field has nothing on file, so the gap is plain to see before anyone signs. */
export function missingFieldText(key: MergeFieldKey): string {
  return `[${mergeFieldLabel(key)}: not on file]`;
}

/**
 * The template with every merge field replaced by its text for this rental.
 * A field with nothing on file reads "[Licence number: not on file]".
 * Returns a new document; the template is never changed.
 */
export function fillMergeFields(document: TemplateDocument, data: ContractData): TemplateDocument {
  const fill = (key: MergeFieldKey): TemplateInline => ({
    type: "text",
    text: data[key] ?? missingFieldText(key),
  });
  return { ...document, content: document.content.map((block) => mapBlock(block, fill)) };
}

/** The merge fields a template uses, each once, in the order they first appear. */
export function mergeFieldsUsed(document: TemplateDocument): MergeFieldKey[] {
  const found: MergeFieldKey[] = [];
  mapBlock({ type: "listItem", content: document.content }, (key) => {
    found.push(key);
    return { type: "text", text: key };
  });
  return [...new Set(found)];
}

/** The fields the template uses that have nothing on file for this rental. */
export function missingMergeFields(
  document: TemplateDocument,
  data: ContractData,
): MergeFieldKey[] {
  return mergeFieldsUsed(document).filter((key) => data[key] === null);
}

const heading = (level: (typeof HEADING_LEVELS)[number], text: string): TemplateBlock => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const paragraph = (...content: TemplateInline[]): TemplateBlock => ({ type: "paragraph", content });
const text = (value: string, isBold = false): TemplateInline =>
  isBold ? { type: "text", text: value, marks: [{ type: "bold" }] } : { type: "text", text: value };
const field = (key: MergeFieldKey): TemplateInline => ({ type: "mergeField", attrs: { key } });
const lineBreak: TemplateInline = { type: "hardBreak" };
const yourTermsNote = (about: string): TemplateBlock =>
  paragraph(text(`Write your terms about ${about} here.`));

/**
 * The starter contract: layout, section headings and the rental's details
 * as merge fields, with notes where the Operator writes their own terms.
 * Deliberately no legal wording (docs/design/05): the Operator's terms are
 * theirs, and they should have them checked by a lawyer.
 */
export const STARTER_CONTRACT: TemplateDocument = {
  type: "doc",
  content: [
    heading(1, "Vehicle rental agreement"),
    paragraph(
      text(
        "Before you use this template: replace every note below with your own terms, and have the finished contract checked by a lawyer.",
        true,
      ),
    ),
    heading(2, "The parties"),
    paragraph(
      text("Owner: ", true),
      field("businessLegalName"),
      text(" (ABN "),
      field("businessAbn"),
      text(")"),
      lineBreak,
      field("businessAddress"),
      lineBreak,
      field("businessPhone"),
      text(" · "),
      field("businessEmail"),
    ),
    paragraph(
      text("Renter: ", true),
      field("renterFullName"),
      text(", born "),
      field("renterDateOfBirth"),
      lineBreak,
      field("renterAddress"),
      lineBreak,
      field("renterPhone"),
      text(" · "),
      field("renterEmail"),
      lineBreak,
      text("Licence "),
      field("renterLicenceNumber"),
      text(" ("),
      field("renterLicenceIssuedIn"),
      text("), expires "),
      field("renterLicenceExpires"),
    ),
    heading(2, "The car"),
    paragraph(
      field("carRego"),
      text(" · "),
      field("carMakeModel"),
      text(" · "),
      field("carYear"),
      lineBreak,
      text("VIN "),
      field("carVin"),
    ),
    heading(2, "Term and rent"),
    {
      type: "bulletList",
      content: [
        ["Kind of rental: ", "rentalKind"],
        ["Starts: ", "rentalStart"],
        ["Ends: ", "rentalEnd"],
        ["Weekly rate: ", "weeklyRate"],
        ["Rent is charged weekly in advance each ", "chargeDay"],
        ["Notice to end an ongoing rental: ", "noticeDays"],
      ].map(([label, key]) => ({
        type: "listItem" as const,
        content: [paragraph(text(label!), field(key as MergeFieldKey))],
      })),
    },
    yourTermsNote("paying rent, late payment and direct debit"),
    heading(2, "Bond"),
    paragraph(text("Bond: "), field("bond")),
    yourTermsNote("when the bond is paid, what it may be used for and when it is returned"),
    heading(2, "Insurance and damage"),
    paragraph(text("Insurance excess: "), field("insuranceExcess")),
    yourTermsNote("insurance, accidents, damage and the excess"),
    heading(2, "Using the car"),
    yourTermsNote("who may drive, rideshare use, servicing, fuel and where the car may go"),
    heading(2, "Fines, tolls and charges"),
    yourTermsNote("fines, tolls, nominating the driver and any fees"),
    heading(2, "Ending the rental and returning the car"),
    yourTermsNote("ending the rental, returning the car and its condition"),
    heading(2, "Signatures"),
    paragraph(text("Issued on "), field("issuedOn")),
    paragraph(
      text("Signed by the Renter electronically. The signing record is attached to this document."),
    ),
  ],
};
