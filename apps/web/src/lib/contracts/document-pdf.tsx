import type { TemplateBlock, TemplateDocument, TemplateInline } from "@fleetapp/core";
import { BRAND } from "@fleetapp/ui/brand";
import path from "node:path";

import {
  Document,
  Font,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ReactElement, ReactNode } from "react";

/**
 * The PDF of a filled-in template, made on the server. Noto Sans is
 * embedded (only the letters used), so every European name prints as
 * typed: the built-in PDF fonts can't print letters such as Ł or ő
 * (review A3-4).
 */

/** Where the font files are: inside the app, included with the server code (next.config.ts). */
export const PDF_FONT_DIRECTORY = path.join(process.cwd(), "assets", "fonts");

const FONT_FILES = {
  regular: "NotoSans-Regular.ttf",
  bold: "NotoSans-Bold.ttf",
  italic: "NotoSans-Italic.ttf",
  boldItalic: "NotoSans-BoldItalic.ttf",
} as const;
type FontStyleName = keyof typeof FONT_FILES;

/** Each style is its own family, so a style is named in one word wherever text is drawn. */
const FONTS: Readonly<Record<FontStyleName, string>> = {
  regular: "PdfSans",
  bold: "PdfSans-Bold",
  italic: "PdfSans-Italic",
  boldItalic: "PdfSans-BoldItalic",
};

for (const style of Object.keys(FONT_FILES) as FontStyleName[]) {
  Font.register({ family: FONTS[style], src: path.join(PDF_FONT_DIRECTORY, FONT_FILES[style]) });
}

const BODY_SIZE = 10;
const HEADING_SIZES = { 1: 18, 2: 13, 3: 11 } as const;
const BULLET = "•";
/** A logo is shown no taller than this, so it never crowds the first heading. */
const LOGO_MAX_HEIGHT = 48;

/** A small copy's height in the PDF: two to a row, about four rows to a page. */
const PHOTO_HEIGHT = 150;

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontFamily: FONTS.regular,
    fontSize: BODY_SIZE,
    lineHeight: 1.45,
    color: BRAND.colours.text,
  },
  logo: { maxHeight: LOGO_MAX_HEIGHT, maxWidth: 160, marginBottom: 16, objectFit: "contain" },
  heading: { fontFamily: FONTS.bold, color: BRAND.colours.primary, marginTop: 10, marginBottom: 4 },
  paragraph: { marginBottom: 6 },
  listRow: { flexDirection: "row", marginBottom: 2 },
  listMarker: { width: 16 },
  listBody: { flex: 1 },
  rule: { borderBottomWidth: 1, borderBottomColor: BRAND.colours.border, marginVertical: 8 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: BRAND.colours.mutedText,
  },
  notice: { fontFamily: FONTS.bold, color: BRAND.colours.danger },
  signatureBlock: {
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: BRAND.colours.border,
  },
  signatureImage: { height: 60, maxWidth: 220, objectFit: "contain", marginVertical: 4 },
  typedSignature: { fontFamily: FONTS.italic, fontSize: 18, marginVertical: 6 },
  recordRow: { flexDirection: "row", marginBottom: 4 },
  recordLabel: { width: 150, color: BRAND.colours.mutedText },
  recordValue: { flex: 1 },
  fingerprint: { fontFamily: "Courier", fontSize: 8 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  photoCell: { width: "50%", paddingRight: 8, marginBottom: 10 },
  photoImage: { height: PHOTO_HEIGHT, objectFit: "contain", marginBottom: 2 },
  photoCaption: { fontSize: BODY_SIZE - 1, color: BRAND.colours.mutedText },
  table: { marginTop: 10, marginBottom: 6 },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.colours.border,
  },
  tableHeader: { fontFamily: FONTS.bold, color: BRAND.colours.primary },
  tableCell: { paddingRight: 6 },
  amountCell: { textAlign: "right", paddingRight: 0 },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 2 },
  totalLabel: { width: 140, textAlign: "right", paddingRight: 10 },
  totalValue: { width: 90, textAlign: "right" },
  grandTotal: { fontFamily: FONTS.bold },
});

function fontFor(marks: readonly { type: string }[] | undefined): string {
  const has = (type: string) => marks?.some((mark) => mark.type === type) ?? false;
  if (has("bold") && has("italic")) {
    return FONTS.boldItalic;
  }
  if (has("bold")) {
    return FONTS.bold;
  }
  return has("italic") ? FONTS.italic : FONTS.regular;
}

function inlineElements(inlines: readonly TemplateInline[] | undefined): ReactNode[] {
  return (inlines ?? []).map((inline, index) => {
    if (inline.type === "hardBreak") {
      return "\n";
    }
    if (inline.type === "mergeField") {
      // Filled before printing; a raw field here would be a bug, so show its key plainly.
      return `[${inline.attrs.key}]`;
    }
    const isUnderlined = inline.marks?.some((mark) => mark.type === "underline") ?? false;
    return (
      <Text
        key={index}
        style={{
          fontFamily: fontFor(inline.marks),
          textDecoration: isUnderlined ? "underline" : "none",
        }}
      >
        {inline.text}
      </Text>
    );
  });
}

/** Inside a list, a paragraph adds no gap of its own: the list row spaces the items. */
function listBlockElement(block: TemplateBlock, key: number): ReactElement {
  return block.type === "paragraph" ? (
    <Text key={key}>{inlineElements(block.content)}</Text>
  ) : (
    blockElement(block, key)
  );
}

function blockElement(block: TemplateBlock, key: number): ReactElement {
  switch (block.type) {
    case "heading":
      return (
        <Text
          key={key}
          style={[styles.heading, { fontSize: HEADING_SIZES[block.attrs.level] }]}
          minPresenceAhead={BODY_SIZE * 3}
        >
          {inlineElements(block.content)}
        </Text>
      );
    case "paragraph":
      return (
        <Text key={key} style={styles.paragraph}>
          {inlineElements(block.content)}
        </Text>
      );
    case "horizontalRule":
      return <View key={key} style={styles.rule} />;
    case "bulletList":
    case "orderedList": {
      const first = block.attrs?.start ?? 1;
      return (
        <View key={key} style={styles.paragraph}>
          {block.content.map((item, index) => (
            <View key={index} style={styles.listRow} wrap={false}>
              <Text style={styles.listMarker}>
                {block.type === "bulletList" ? BULLET : `${first + index}.`}
              </Text>
              <View style={styles.listBody}>{item.content.map(listBlockElement)}</View>
            </View>
          ))}
        </View>
      );
    }
    case "listItem":
      return <View key={key}>{block.content.map(listBlockElement)}</View>;
  }
}

/** How the document was signed, shown under its text. */
export interface PdfSignature {
  /** "Signed by Sam Example". */
  signedByText: string;
  /** "Signed electronically on 3 Nov 2026, 2:15 pm AWST". */
  signedAtText: string;
  /** A drawn signature, as PNG bytes. */
  drawnPng?: Uint8Array;
  /** A typed signature: the name as typed. */
  typedName?: string;
}

/** The last page: each step of the signing, and the fingerprint of the text signed. */
export interface PdfSigningRecord {
  rows: readonly (readonly [label: string, value: string])[];
  /** The SHA-256 of the text the Renter was shown and signed. */
  contentFingerprint: string;
}

/** An image as a PDF can print it. */
export interface PdfImage {
  data: Buffer;
  format: "png" | "jpg";
}

/** A photo printed small in a report (rule 21): its small copy, with its name under it. */
export interface PdfPhoto {
  caption: string;
  /** Missing when it could not be printed; the caption says it is kept with the rental. */
  image?: PdfImage | undefined;
  /** What is said in its place when there is no image, if not the usual note. */
  missingNote?: string;
}

function PhotoGrid({ heading, photos }: { heading: string; photos: readonly PdfPhoto[] }) {
  return (
    <View>
      <Text style={[styles.heading, { fontSize: HEADING_SIZES[2] }]}>{heading}</Text>
      <View style={styles.photoGrid}>
        {photos.map((photo, index) => (
          <View key={`${photo.caption}-${index}`} style={styles.photoCell} wrap={false}>
            {photo.image ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- a PDF image; its caption names it
              <Image src={photo.image} style={styles.photoImage} />
            ) : null}
            <Text style={styles.photoCaption}>
              {photo.image
                ? photo.caption
                : `${photo.caption} ${photo.missingNote ?? "(photo kept with the rental)"}`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SignatureBlock({ signature }: { signature: PdfSignature }): ReactElement {
  return (
    <View style={styles.signatureBlock} wrap={false}>
      <Text style={styles.heading}>{signature.signedByText}</Text>
      {signature.drawnPng ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- a PDF image; the text above names it
        <Image
          src={{ data: Buffer.from(signature.drawnPng), format: "png" }}
          style={styles.signatureImage}
        />
      ) : (
        <Text style={styles.typedSignature}>{signature.typedName}</Text>
      )}
      <Text>{signature.signedAtText}</Text>
    </View>
  );
}

function SigningRecordPage({ record }: { record: PdfSigningRecord }): ReactElement {
  return (
    <View break>
      <Text style={[styles.heading, { fontSize: HEADING_SIZES[2] }]}>Signing record</Text>
      <Text style={styles.paragraph}>
        How this document was signed electronically. Times are on the business&apos;s clock.
      </Text>
      {record.rows.map(([label, value]) => (
        <View key={label} style={styles.recordRow} wrap={false}>
          <Text style={styles.recordLabel}>{label}</Text>
          <Text style={styles.recordValue}>{value}</Text>
        </View>
      ))}
      <Text style={[styles.paragraph, { marginTop: 10 }]}>
        Fingerprint (SHA-256) of the contract text the Renter was shown and signed:
      </Text>
      <Text style={styles.fingerprint}>{record.contentFingerprint}</Text>
    </View>
  );
}

/** A table of items, e.g. an invoice's lines, with its totals under it. */
export interface PdfTable {
  /** Each column's heading and its share of the width; amounts are set right. */
  columns: readonly { label: string; widthPercent: number; isAmount?: boolean }[];
  rows: readonly (readonly string[])[];
  /** Under the table, right-aligned; the last is the total, in bold. */
  totals: readonly (readonly [label: string, value: string])[];
}

function TableCells({ table, cells }: { table: PdfTable; cells: readonly string[] }) {
  return table.columns.map((column, index) => (
    <Text
      key={column.label}
      style={[
        styles.tableCell,
        { width: `${column.widthPercent}%` },
        column.isAmount ? styles.amountCell : {},
      ]}
    >
      {cells[index] ?? ""}
    </Text>
  ));
}

function ItemTable({ table }: { table: PdfTable }): ReactElement {
  return (
    <View style={styles.table}>
      <View style={[styles.tableRow, styles.tableHeader]} fixed>
        <TableCells table={table} cells={table.columns.map((column) => column.label)} />
      </View>
      {table.rows.map((row, index) => (
        <View key={index} style={styles.tableRow} wrap={false}>
          <TableCells table={table} cells={row} />
        </View>
      ))}
      {table.totals.map(([label, value], index) => (
        <View
          key={label}
          style={[styles.totalRow, index === table.totals.length - 1 ? styles.grandTotal : {}]}
          wrap={false}
        >
          <Text style={styles.totalLabel}>{label}</Text>
          <Text style={styles.totalValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

export interface DocumentPdfInput {
  /** The PDF's title, e.g. "Rental contract 1ABC234". */
  title: string;
  /** The business it is from: the PDF's author and the footer. */
  businessName: string;
  /** The filled-in template: every merge field already replaced by text. */
  document: TemplateDocument;
  /** The business's logo, PNG or JPEG. */
  logo?: PdfImage | undefined;
  /** In red in every footer, e.g. "Preview: not issued". */
  notice?: string | undefined;
  signature?: PdfSignature | undefined;
  signingRecord?: PdfSigningRecord | undefined;
  /** Items after the text, e.g. an invoice's lines and totals. */
  table?: PdfTable | undefined;
  /** Text after the table, e.g. how to pay. */
  closing?: TemplateDocument | undefined;
  /** Photos after the text, e.g. a handover's. */
  photos?: { heading: string; photos: readonly PdfPhoto[] } | undefined;
}

/** The PDF's bytes. */
export async function renderDocumentPdf(input: DocumentPdfInput): Promise<Uint8Array> {
  const buffer = await renderToBuffer(
    <Document title={input.title} author={input.businessName} creator={input.businessName}>
      <Page size="A4" style={styles.page}>
        {input.logo ? (
          // A PDF image, not a web page's: react-pdf has no alt text; the PDF's title names it.
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={input.logo} style={styles.logo} />
        ) : null}
        {input.document.content.map(blockElement)}
        {input.table ? <ItemTable table={input.table} /> : null}
        {input.closing ? input.closing.content.map(blockElement) : null}
        {input.photos && input.photos.photos.length > 0 ? (
          <PhotoGrid heading={input.photos.heading} photos={input.photos.photos} />
        ) : null}
        {input.signature ? <SignatureBlock signature={input.signature} /> : null}
        {input.signingRecord ? <SigningRecordPage record={input.signingRecord} /> : null}
        <View style={styles.footer} fixed>
          <Text>
            {input.businessName}
            {input.notice ? <Text style={styles.notice}>{`  ·  ${input.notice}`}</Text> : null}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>,
  );
  return new Uint8Array(buffer);
}
