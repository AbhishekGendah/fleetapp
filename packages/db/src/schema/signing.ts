import { SIGNING_EVIDENCE_STEPS } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn } from "./columns";
import { issuedDocuments } from "./contracts";
import { operatorIdColumn } from "./operators";
import { rentals } from "./rentals";
import { renterLinks } from "./renter-links";

export const signingEvidenceStepEnum = pgEnum("signing_evidence_step", SIGNING_EVIDENCE_STEPS);

/**
 * What happened at each step of a Renter signing through their link: when,
 * from which internet address and browser, and the details of the step (the
 * fingerprint of the text shown, how they signed). Evidence under the
 * Electronic Transactions Act, never changed or removed, and never in the
 * activity log's text (rule 7). Personal information: no admin access.
 */
export const signingEvidence = pgTable(
  "signing_evidence",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    linkId: uuid("link_id").notNull(),
    rentalId: uuid("rental_id").notNull(),
    step: signingEvidenceStepEnum("step").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    /** The signed contract, on the "signed" step. */
    issuedDocumentId: uuid("issued_document_id"),
  },
  (table) => [
    foreignKey({
      name: "signing_evidence_link_fk",
      columns: [table.linkId, table.operatorId],
      foreignColumns: [renterLinks.id, renterLinks.operatorId],
    }),
    foreignKey({
      name: "signing_evidence_rental_fk",
      columns: [table.rentalId, table.operatorId],
      foreignColumns: [rentals.id, rentals.operatorId],
    }),
    foreignKey({
      name: "signing_evidence_document_fk",
      columns: [table.issuedDocumentId, table.operatorId],
      foreignColumns: [issuedDocuments.id, issuedDocuments.operatorId],
    }),
    index("signing_evidence_link_idx").on(table.operatorId, table.linkId),
  ],
);
