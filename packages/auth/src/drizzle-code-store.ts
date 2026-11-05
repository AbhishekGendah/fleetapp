import { hashSecretToken } from "@fleetapp/core/server";
import { sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { columnName, firstRow, type SqlExecutor } from "./sql-helpers";

/**
 * How long an authenticator code stays acceptable: its own 30 seconds and
 * one step either side, as Better Auth checks it.
 */
const CODE_LIFETIME_SECONDS = 90;

/** The two-factor table and columns that remember the last code: `admin_two_factors` or `user_two_factors`. */
export interface CodeTable {
  table: PgTable;
  userId: PgColumn;
  lastCodeHash: PgColumn;
  lastCodeAt: PgColumn;
}

/** What the login guard needs to stop a code being used twice and to age remembered devices. */
export interface CodeStore {
  /** Whether this exact code was accepted for this login within its lifetime (review A2-7). */
  wasJustUsed(userId: string, code: string, now: Date): Promise<boolean>;
  /** Notes a code accepted now; a recovery code notes only the time. */
  noteCodeTyped(userId: string, code: string | null, now: Date): Promise<void>;
  /** When a code was last typed for this login, or null if never since this was built. */
  lastCodeAt(userId: string): Promise<Date | null>;
}

/** Only a fingerprint is kept, tied to the login, never the code itself. */
function codeFingerprint(userId: string, code: string): string {
  return hashSecretToken(`${userId}:${code}`);
}

export function createDrizzleCodeStore(database: SqlExecutor, columns: CodeTable): CodeStore {
  return {
    async wasJustUsed(userId, code, now) {
      const since = new Date(now.getTime() - CODE_LIFETIME_SECONDS * 1000).toISOString();
      const result = await database.execute(sql`
        SELECT 1 AS used FROM ${columns.table}
        WHERE ${columns.userId} = ${userId}
          AND ${columns.lastCodeHash} = ${codeFingerprint(userId, code)}
          AND ${columns.lastCodeAt} > ${since}::timestamptz
      `);
      return firstRow(result) !== undefined;
    },

    async noteCodeTyped(userId, code, now) {
      await database.execute(sql`
        UPDATE ${columns.table} SET
          ${columnName(columns.lastCodeHash)} = ${code === null ? null : codeFingerprint(userId, code)},
          ${columnName(columns.lastCodeAt)} = ${now.toISOString()}::timestamptz
        WHERE ${columns.userId} = ${userId}
      `);
    },

    async lastCodeAt(userId) {
      const result = await database.execute(sql`
        SELECT ${columns.lastCodeAt} AS last_code_at FROM ${columns.table}
        WHERE ${columns.userId} = ${userId}
      `);
      const value = firstRow(result)?.last_code_at;
      return value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
    },
  };
}
