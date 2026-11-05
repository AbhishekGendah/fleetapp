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
  "invoice",
  "credit_note",
  "receipt",
  "statement",
] as const;
export type IssuedDocumentKind = (typeof ISSUED_DOCUMENT_KINDS)[number];

/** What each issued document is called, e.g. in "everything we hold". */
export const ISSUED_DOCUMENT_NAMES: Readonly<Record<IssuedDocumentKind, string>> = {
  contract: "Rental contract",
  handover_report: "Handover report",
  return_report: "Return report",
  swap_form: "Car swap form",
  change_of_terms: "Change of terms",
  invoice: "Tax invoice",
  credit_note: "Credit note",
  receipt: "Receipt",
  statement: "Statement",
};

export const MERGE_FIELD_GROUPS = [
  "business",
  "renter",
  "car",
  "rental",
  "change",
  "swap",
] as const;
export type MergeFieldGroup = (typeof MERGE_FIELD_GROUPS)[number];

export const MERGE_FIELD_GROUP_LABELS: Readonly<Record<MergeFieldGroup, string>> = {
  business: "Your business",
  renter: "Renter",
  car: "Car",
  rental: "Rental",
  change: "Change of terms (filled in only on that form)",
  swap: "Car swap (filled in only on that form)",
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
  { key: "dailyRate", label: "Daily rate", group: "rental" },
  { key: "longTermWeeklyRate", label: "Long-term price per week", group: "rental" },
  { key: "longTermMinimum", label: "Long-term minimum", group: "rental" },
  { key: "gracePeriod", label: "Grace period at the return", group: "rental" },
  { key: "bond", label: "Bond", group: "rental" },
  { key: "chargeDay", label: "Rent charged each", group: "rental" },
  { key: "noticeDays", label: "Notice to end an ongoing rental", group: "rental" },
  { key: "issuedOn", label: "Date of issue", group: "rental" },
  { key: "changeSummary", label: "What is changing", group: "change" },
  { key: "changeReason", label: "Why", group: "change" },
  { key: "changeNewRate", label: "New weekly rate", group: "change" },
  { key: "changeRateFrom", label: "New rate applies from", group: "change" },
  { key: "changeNewEnd", label: "New end", group: "change" },
  { key: "swapOldCar", label: "Car handed back", group: "swap" },
  { key: "swapNewCar", label: "Car received", group: "swap" },
  { key: "swapAt", label: "When swapped", group: "swap" },
  { key: "swapReason", label: "Why swapped", group: "swap" },
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
const documentShapeSchema = z
  .object({ type: z.literal("doc"), content: z.array(blockSchema).min(1) })
  .strict()
  .refine(
    (document) => JSON.stringify(document).length <= MAXIMUM_TEMPLATE_CHARACTERS,
    `A template can hold at most ${MAXIMUM_TEMPLATE_CHARACTERS.toLocaleString("en-AU")} characters.`,
  );

/** Lists inside lists, at most this deep: far more than any contract needs (review G5-3). */
export const MAXIMUM_LIST_NESTING = 20;
/** However it nests, the stored document goes no deeper than this. */
const MAXIMUM_DOCUMENT_DEPTH = 8 * MAXIMUM_LIST_NESTING;
const LIST_TYPES: ReadonlySet<unknown> = new Set(["bulletList", "orderedList"]);
export const TEMPLATE_TOO_NESTED_MESSAGE = `This template is too complex: lists can be nested at most ${MAXIMUM_LIST_NESTING} deep.`;

/**
 * Whether a document nests too deeply to check or print safely. Walked
 * without recursion, so a doctored, very deep document can't exhaust the
 * server's stack before it is refused (review G5-3).
 */
function isTooNested(document: unknown): boolean {
  const waiting: { value: unknown; depth: number; lists: number }[] = [
    { value: document, depth: 0, lists: 0 },
  ];
  for (let next = waiting.pop(); next; next = waiting.pop()) {
    const { value, depth, lists } = next;
    if (depth > MAXIMUM_DOCUMENT_DEPTH || lists > MAXIMUM_LIST_NESTING) {
      return true;
    }
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const isList = !Array.isArray(value) && LIST_TYPES.has(Reflect.get(value, "type"));
    for (const child of Object.values(value)) {
      waiting.push({ value: child, depth: depth + 1, lists: lists + (isList ? 1 : 0) });
    }
  }
  return false;
}

export const templateDocumentSchema = z
  .unknown()
  .superRefine((document, context) => {
    if (isTooNested(document)) {
      context.addIssue({ code: "custom", message: TEMPLATE_TOO_NESTED_MESSAGE, fatal: true });
    }
  })
  .pipe(documentShapeSchema);
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
        ["Daily rate: ", "dailyRate"],
        ["Weekly rate (long-term): ", "weeklyRate"],
        ["Rent is charged in advance each ", "chargeDay"],
        ["A rental of ", "longTermMinimum"],
        ["Grace period before another day is charged at the return: ", "gracePeriod"],
        ["Notice to end an ongoing rental: ", "noticeDays"],
      ].map(([label, key]) => ({
        type: "listItem" as const,
        content: [paragraph(text(label!), field(key as MergeFieldKey))],
      })),
    },
    paragraph(
      text(
        "Rent is counted in 24-hour blocks from the time you sign for the car at the handover. A long-term rental that ends before its minimum is charged at the daily rate for the days used, unless we agree otherwise.",
      ),
    ),
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

/**
 * The starter change-of-terms form: who, which rental, what changes and
 * why, as merge fields, with a note for the business's own wording. As with
 * the contract, no legal wording.
 */
export const STARTER_CHANGE_OF_TERMS: TemplateDocument = {
  type: "doc",
  content: [
    heading(1, "Change of terms"),
    paragraph(
      text(
        "Before you use this template: add your own wording, and have it checked by a lawyer.",
        true,
      ),
    ),
    paragraph(
      text("Between "),
      field("businessLegalName"),
      text(" (ABN "),
      field("businessAbn"),
      text(") and "),
      field("renterFullName"),
      text(", for the rental of "),
      field("carRego"),
      text(" "),
      field("carMakeModel"),
      text(" that started "),
      field("rentalStart"),
      text("."),
    ),
    heading(2, "What changes"),
    paragraph(field("changeSummary")),
    paragraph(text("Why: "), field("changeReason")),
    yourTermsNote("how this change fits with the rest of the contract"),
    paragraph(text("Everything else in the rental contract stays the same.")),
    heading(2, "Signature"),
    paragraph(text("Issued on "), field("issuedOn")),
    paragraph(
      text("Signed by the Renter electronically. The signing record is attached to this document."),
    ),
  ],
};

/**
 * The starter car swap form: the car handed back and the car received, when
 * and why, with a note for the business's own wording. No legal wording.
 */
export const STARTER_SWAP_FORM: TemplateDocument = {
  type: "doc",
  content: [
    heading(1, "Car swap"),
    paragraph(
      text(
        "Before you use this template: add your own wording, and have it checked by a lawyer.",
        true,
      ),
    ),
    paragraph(
      text("Between "),
      field("businessLegalName"),
      text(" and "),
      field("renterFullName"),
      text(", for the rental that started "),
      field("rentalStart"),
      text("."),
    ),
    heading(2, "The swap"),
    paragraph(text("Car handed back: ", true), field("swapOldCar")),
    paragraph(text("Car received: ", true), field("swapNewCar")),
    paragraph(text("When: "), field("swapAt")),
    paragraph(text("Why: "), field("swapReason")),
    yourTermsNote("the swap, and the condition of each car (see the two reports)"),
    paragraph(text("Everything else in the rental contract stays the same, for the car received.")),
    heading(2, "Signature"),
    paragraph(text("Signed by the Renter on the business's device.")),
  ],
};

/** What a new template of each kind starts as. */
export const STARTER_TEMPLATES: Readonly<Record<ContractTemplateKind, TemplateDocument>> = {
  contract: STARTER_CONTRACT,
  swap_form: STARTER_SWAP_FORM,
  change_of_terms: STARTER_CHANGE_OF_TERMS,
};

/**
 * The fields a contract needs so the Renter agrees to how rent in 24-hour
 * blocks is charged (docs/legal-notes.md): without them the re-pricing and
 * grace terms are not in what they sign.
 */
export const BLOCK_RENT_TERM_FIELDS: readonly MergeFieldKey[] = [
  "dailyRate",
  "longTermMinimum",
  "gracePeriod",
];

/** The block rent terms a contract template leaves out (none for other kinds of form). */
export function missingRentTermFields(document: TemplateDocument): MergeFieldKey[] {
  const used = new Set(mergeFieldsUsed(document));
  return BLOCK_RENT_TERM_FIELDS.filter((key) => !used.has(key));
}
