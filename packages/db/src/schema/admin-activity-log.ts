import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { primaryKeyColumn } from "./columns";

/**
 * Append-only record of Admin sign-ins, failures and lockouts.
 *
 * Separate from `activity_log` because that table requires an `operator_id`
 * and these events belong to AGS, not to any Operator. An Admin signing in is
 * not an event in any Operator's history.
 *
 * `ipAddress` is recorded because an audit trail that cannot answer "from
 * where" is close to useless when something goes wrong. Better Auth already
 * stores it against each session regardless. Rule 7's ban on logging personal
 * data is about Renters' details — licences, bank accounts — not an audit
 * trail of AGS's own staff.
 *
 * Never recorded here: passwords, authenticator codes, recovery codes,
 * session tokens.
 */
export const adminActivityLog = pgTable(
  "admin_activity_log",
  {
    ...primaryKeyColumn,

    /**
     * Null when the attempt names an email that matches no Admin. Recording
     * the attempt still matters; guessing which Admin was meant does not.
     */
    adminUserId: uuid("admin_user_id"),

    action: text("action").notNull(),
    ipAddress: text("ip_address"),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("admin_activity_log_admin_user_id_idx").on(table.adminUserId, table.occurredAt.desc()),
    index("admin_activity_log_occurred_at_idx").on(table.occurredAt.desc()),
  ],
);

/** The actions written to the Admin activity log. No free text at call sites. */
export const ADMIN_ACTIVITY_ACTIONS = {
  signedIn: "signed_in",
  signInFailed: "sign_in_failed",
  signedOut: "signed_out",
  twoFactorEnrolled: "two_factor_enrolled",
  created: "created",
} as const;

export type AdminActivityAction =
  (typeof ADMIN_ACTIVITY_ACTIONS)[keyof typeof ADMIN_ACTIVITY_ACTIONS];
