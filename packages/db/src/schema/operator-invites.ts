import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { adminUsers } from "./admin-users";
import { primaryKeyColumn } from "./columns";
import { operatorIdColumn } from "./operators";
import { users } from "./users";

/**
 * An invitation for a User to set up their login, sent when an Admin creates
 * the Operator.
 *
 * Only a SHA-256 fingerprint of the link's secret is stored, never the secret
 * itself, so a leaked backup cannot be turned into working invite links. That
 * is also why an invite cannot be re-sent as the same link: resending revokes
 * this row and issues a new one.
 *
 * Never deleted. A used, expired or revoked invite is a record of what
 * happened. The admin app's role may change only `sent_at` and `revoked_at`;
 * `accepted_at` belongs to the Operator login system (slice 4).
 */
export const operatorInvites = pgTable(
  "operator_invites",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),

    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** Empty until the email has actually gone, so a failed send is visible. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdByAdminId: uuid("created_by_admin_id")
      .notNull()
      .references(() => adminUsers.id),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("operator_invites_token_hash_unique").on(table.tokenHash),
    index("operator_invites_operator_id_idx").on(table.operatorId, table.createdAt.desc()),
    index("operator_invites_user_id_idx").on(table.userId),
  ],
);
