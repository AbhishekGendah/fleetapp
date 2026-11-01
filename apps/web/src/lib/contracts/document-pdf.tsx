import type { TemplateBlock, TemplateDocument, TemplateInline } from "@fleetapp/core";
import { BRAND } from "@fleetapp/ui/brand";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactElement, ReactNode } from "react";

/**
 * The PDF of a filled-in template, made on the server. PDFs use the
 * built-in Helvetica, which covers English and Western European accents
 * (é, ñ, ü); other scripts need an embedded font (docs/progress.md).
 */

const FONTS = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  boldItalic: "Helvetica-BoldOblique",
} as const;
const BODY_SIZE = 10;
const HEADING_SIZES = { 1: 18, 2: 13, 3: 11 } as const;
const BULLET = "•";
/** A logo is shown no taller than this, so it never crowds the first heading. */
const LOGO_MAX_HEIGHT = 48;

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

export interface DocumentPdfInput {
  /** The PDF's title, e.g. "Rental contract 1ABC234". */
  title: string;
  /** The business it is from: the PDF's author and the footer. */
  businessName: string;
  /** The filled-in template: every merge field already replaced by text. */
  document: TemplateDocument;
  /** The business's logo, PNG or JPEG. */
  logo?: { data: Buffer; format: "png" | "jpg" } | undefined;
  /** In red in every footer, e.g. "Preview: not issued". */
  notice?: string | undefined;
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
