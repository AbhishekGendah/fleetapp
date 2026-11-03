import {
  BILLING_DOCUMENT_KINDS,
  MAXIMUM_DOCUMENT_NUMBER,
  NUMBER_PREFIX_MAX_LENGTH,
  NUMBERING_SERIES,
} from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn } from "./columns";
import { issuedDocuments } from "./contracts";
import { ledgerLines } from "./ledger";
import { operatorIdColumn } from "./operators";
import { rentalLink } from "./rentals";

export const numberingSeriesEnum = pgEnum("numbering_series", NUMBERING_SERIES);
export const billingDocumentKindEnum = pgEnum("billing_document_kind", BILLING_DOCUMENT_KINDS);

/**
 * A business's next invoice (or receipt) number (rule 17). Taken and moved
 * on in the transaction that issues the document, so a failure takes
 * neither. Once the first is issued the database lets the number move on by
 * one only, and at commit refuses any number taken without its document.
 */
export const documentNumbering = pgTable(
  "document_numbering",
  {
    ...operatorIdColumn,
    series: numberingSeriesEnum("series").notNull(),
    prefix: text("prefix").notNull(),
    nextNumber: integer("next_number").notNull(),
    /** Set by the first document issued: the starting number is fixed from then. */
    isStarted: boolean("is_started").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({ name: "document_numbering_pk", columns: [table.operatorId, table.series] }),
    check(
      "document_numbering_next_number",
      sql`${table.nextNumber} between 1 and ${sql.raw(String(MAXIMUM_DOCUMENT_NUMBER + 1))}`,
    ),
    check(
      "document_numbering_prefix",
      sql`length(${table.prefix}) <= ${sql.raw(String(NUMBER_PREFIX_MAX_LENGTH))}`,
    ),
  ],
);

/**
 * An invoice, credit note or receipt (docs/plans/phase-4.md, slice 2): its
 * number, totals and the fixed PDF it was issued as (rule 12). Only ever
 * added; a mistake on an invoice is corrected by a credit note.
 */
export const billingDocuments = pgTable(
  "billing_documents",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    kind: billingDocumentKindEnum("kind").notNull(),
    number: integer("number").notNull(),
    /** As printed, prefix and all, e.g. "INV-1001": a later prefix change never alters it. */
    numberText: text("number_text").notNull(),
    issuedOn: date("issued_on").notNull(),
    /** A tax invoice or adjustment note: the business was GST-registered on the day. */
    isTaxDocument: boolean("is_tax_document").notNull(),
    totalCents: integer("total_cents").notNull(),
    gstCents: integer("gst_cents").notNull(),
    /** The invoice a credit note corrects, when it is known. */
    relatesToId: uuid("relates_to_id"),
    issuedDocumentId: uuid("issued_document_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    rentalLink("billing_documents", table),
    unique("billing_documents_id_operator_unique").on(table.id, table.operatorId),
    unique("billing_documents_id_rental_unique").on(table.id, table.operatorId, table.rentalId),
    unique("billing_documents_issued_document_unique").on(table.issuedDocumentId),
    foreignKey({
      name: "billing_documents_relates_to_fk",
      columns: [table.relatesToId, table.operatorId, table.rentalId],
      foreignColumns: [table.id, table.operatorId, table.rentalId],
    }),
    foreignKey({
      name: "billing_documents_issued_document_fk",
      columns: [table.issuedDocumentId, table.operatorId],
      foreignColumns: [issuedDocuments.id, issuedDocuments.operatorId],
    }),
    // Invoices and credit notes share a sequence; receipts have their own (rule 17).
    uniqueIndex("billing_documents_invoice_number_unique")
      .on(table.operatorId, table.number)
      .where(sql`${table.kind} in ('invoice', 'credit_note')`),
    uniqueIndex("billing_documents_receipt_number_unique")
      .on(table.operatorId, table.number)
      .where(sql`${table.kind} = 'receipt'`),
    index("billing_documents_rental_idx").on(table.operatorId, table.rentalId),
    check("billing_documents_total", sql`${table.totalCents} >= 0`),
    check(
      "billing_documents_gst",
      sql`${table.gstCents} >= 0 and ${table.gstCents} <= ${table.totalCents}`,
    ),
    check(
      "billing_documents_relates_to",
      sql`${table.relatesToId} is null or ${table.kind} = 'credit_note'`,
    ),
    check("billing_documents_number_text", sql`length(${table.numberText}) > 0`),
  ],
);

/** Which ledger lines a document is made of: each line is on one document at most. */
export const billingDocumentLines = pgTable(
  "billing_document_lines",
  {
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    billingDocumentId: uuid("billing_document_id").notNull(),
    ledgerLineId: uuid("ledger_line_id").notNull(),
  },
  (table) => [
    primaryKey({ name: "billing_document_lines_pk", columns: [table.ledgerLineId] }),
    // The document and the line belong to the same rental of the same business.
    foreignKey({
      name: "billing_document_lines_document_fk",
      columns: [table.billingDocumentId, table.operatorId, table.rentalId],
      foreignColumns: [billingDocuments.id, billingDocuments.operatorId, billingDocuments.rentalId],
    }),
    foreignKey({
      name: "billing_document_lines_ledger_line_fk",
      columns: [table.ledgerLineId, table.operatorId, table.rentalId],
      foreignColumns: [ledgerLines.id, ledgerLines.operatorId, ledgerLines.rentalId],
    }),
    index("billing_document_lines_document_idx").on(table.operatorId, table.billingDocumentId),
  ],
);
