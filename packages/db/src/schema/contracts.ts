import {
  CONTRACT_TEMPLATE_KINDS,
  DOCUMENT_EMAIL_OUTCOMES,
  DOCUMENT_EMAIL_RECIPIENTS,
  ISSUED_DOCUMENT_KINDS,
  type TemplateDocument,
} from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { auditColumns, primaryKeyColumn } from "./columns";
import { files } from "./files";
import { inspectionLink } from "./inspections";
import { operatorIdColumn } from "./operators";
import { rentals } from "./rentals";
import { renters } from "./renters";
import { users } from "./users";

export const contractTemplateKindEnum = pgEnum("contract_template_kind", CONTRACT_TEMPLATE_KINDS);
export const issuedDocumentKindEnum = pgEnum("issued_document_kind", ISSUED_DOCUMENT_KINDS);

const createdAtColumn = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
} as const;

/**
 * One of the Operator's templates: a rental contract, swap form or change
 * of terms. Its text lives in its versions; the default of each kind is the
 * one new rentals use.
 */
export const contractTemplates = pgTable(
  "contract_templates",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    kind: contractTemplateKindEnum("kind").notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    ...auditColumns,
  },
  (table) => [
    unique("contract_templates_id_operator_unique").on(table.id, table.operatorId),
    uniqueIndex("contract_templates_one_default_per_kind")
      .on(table.operatorId, table.kind)
      .where(sql`${table.isDefault} and ${table.archivedAt} is null`),
    index("contract_templates_operator_idx").on(table.operatorId, table.kind),
  ],
);

/**
 * A template's text at one point in time. Saving an edit adds a version;
 * a version is never changed, so anything issued from it can always be
 * traced to the exact words (rule 12).
 */
export const contractTemplateVersions = pgTable(
  "contract_template_versions",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    templateId: uuid("template_id").notNull(),
    version: integer("version").notNull(),
    content: jsonb("content").$type<TemplateDocument>().notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    ...createdAtColumn,
  },
  (table) => [
    foreignKey({
      name: "contract_template_versions_template_fk",
      columns: [table.templateId, table.operatorId],
      foreignColumns: [contractTemplates.id, contractTemplates.operatorId],
    }),
    unique("contract_template_versions_id_operator_unique").on(table.id, table.operatorId),
    unique("contract_template_versions_number_unique").on(
      table.operatorId,
      table.templateId,
      table.version,
    ),
    check("contract_template_versions_version", sql`${table.version} > 0`),
  ],
);

/**
 * A fixed document issued for a rental (rule 12): the PDF as stored, its
 * SHA-256 fingerprint, and the template version it was made from. Never
 * changed or removed; a correction is a new version of the same kind. A
 * business Renter's statement across its cars belongs to the Renter instead
 * of one rental (docs/plans/business-renters.md, Migration B).
 */
export const issuedDocuments = pgTable(
  "issued_documents",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    /** None only for a Renter's statement across their rentals. */
    rentalId: uuid("rental_id"),
    /** The Renter a statement across their rentals is for; none for everything else. */
    renterId: uuid("renter_id"),
    kind: issuedDocumentKindEnum("kind").notNull(),
    version: integer("version").notNull(),
    templateVersionId: uuid("template_version_id"),
    /** The handover or return checklist a report was made from. */
    inspectionId: uuid("inspection_id"),
    fileId: uuid("file_id").notNull(),
    sha256: text("sha256").notNull(),
    /** Who issued it; none when the app did on its own (e.g. once a Renter signs). */
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "issued_documents_rental_fk",
      columns: [table.rentalId, table.operatorId],
      foreignColumns: [rentals.id, rentals.operatorId],
    }),
    foreignKey({
      name: "issued_documents_renter_fk",
      columns: [table.renterId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    foreignKey({
      name: "issued_documents_template_version_fk",
      columns: [table.templateVersionId, table.operatorId],
      foreignColumns: [contractTemplateVersions.id, contractTemplateVersions.operatorId],
    }),
    foreignKey({
      name: "issued_documents_file_fk",
      columns: [table.fileId, table.operatorId],
      foreignColumns: [files.id, files.operatorId],
    }),
    unique("issued_documents_version_unique").on(
      table.operatorId,
      table.rentalId,
      table.kind,
      table.version,
    ),
    unique("issued_documents_renter_version_unique").on(
      table.operatorId,
      table.renterId,
      table.kind,
      table.version,
    ),
    check(
      "issued_documents_one_owner",
      sql`(${table.rentalId} is null) <> (${table.renterId} is null)`,
    ),
    check(
      "issued_documents_renter_statement",
      sql`${table.renterId} is null or ${table.kind} = 'statement'`,
    ),
    unique("issued_documents_file_unique").on(table.fileId),
    inspectionLink("issued_documents", table),
    check(
      "issued_documents_report_inspection",
      sql`(${table.kind}::text in ('handover_report', 'return_report')) = (${table.inspectionId} is not null)`,
    ),
    unique("issued_documents_id_operator_unique").on(table.id, table.operatorId),
    check("issued_documents_version", sql`${table.version} > 0`),
    check("issued_documents_sha256", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * Each try at emailing a copy of an issued document, to the Renter, a
 * business's driver or the business: never changed, a resend is a new row (review G7-1, G9-9). Kept
 * apart from the document, which can never be changed (rule 12).
 */
export const documentEmails = pgTable(
  "document_emails",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    documentId: uuid("document_id").notNull(),
    recipient: text("recipient", { enum: DOCUMENT_EMAIL_RECIPIENTS }).notNull(),
    outcome: text("outcome", { enum: DOCUMENT_EMAIL_OUTCOMES }).notNull(),
    /** Who pressed "Email again"; none for the copy sent when it was issued. */
    sentByUserId: uuid("sent_by_user_id").references(() => users.id),
    triedAt: timestamp("tried_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "document_emails_document_fk",
      columns: [table.documentId, table.operatorId],
      foreignColumns: [issuedDocuments.id, issuedDocuments.operatorId],
    }),
    index("document_emails_document_idx").on(table.operatorId, table.documentId, table.triedAt),
    check("document_emails_recipient", sql`${table.recipient} in ('renter', 'driver', 'business')`),
    check("document_emails_outcome", sql`${table.outcome} in ('sent', 'failed', 'no_address')`),
  ],
);
