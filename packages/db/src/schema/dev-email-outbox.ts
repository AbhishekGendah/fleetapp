import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { primaryKeyColumn } from "./columns";

/**
 * The test inbox: every email the system would have sent, kept here instead of
 * being sent, so invites and other emails can be tried out before a real email
 * provider exists.
 *
 * Belongs to AGS rather than to an Operator, so it carries no `operator_id`
 * and is listed in `NON_TENANT_TABLES`. Never written to in production, where
 * email goes through the real provider instead. Both app roles can add to it;
 * only the admin app's role can read it.
 */
export const devEmailOutbox = pgTable(
  "dev_email_outbox",
  {
    ...primaryKeyColumn,

    toAddress: text("to_address").notNull(),
    fromAddress: text("from_address").notNull(),
    /** Where a reply goes, when not the sender: e.g. the Operator, for Renter emails. */
    replyTo: text("reply_to"),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("dev_email_outbox_created_at_idx").on(table.createdAt.desc())],
);
