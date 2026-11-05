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
  /** Better Auth's own: set when five wrong codes lock the login. */
  lockedUntil: PgColumn;
}

/** What the login guard needs to stop a code being used twice and to age remembered devices. */
export interface CodeStore {
  /** Whether this exact code was accepted for this login within its lifetime (review A2-7). */
  wasJustUsed(userId: string, code: string, now: Date): Promise<boolean>;
  /**
   * Claims a code just accepted, in one statement, so two requests can't
   * both use it: false if it was already claimed within its lifetime. A
   * recovery code notes only the time.
   */
  claimCode(userId: string, code: string | null, now: Date): Promise<boolean>;
  /** Whether five wrong codes have locked the login right now. */
  isCodeLocked(userId: string, now: Date): Promise<boolean>;
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

    async claimCode(userId, code, now) {
      const since = new Date(now.getTime() - CODE_LIFETIME_SECONDS * 1000).toISOString();
      const fingerprint = code === null ? null : codeFingerprint(userId, code);
      const result = await database.execute(sql`
        UPDATE ${columns.table} SET
          ${columnName(columns.lastCodeHash)} = ${fingerprint},
          ${columnName(columns.lastCodeAt)} = ${now.toISOString()}::timestamptz
        WHERE ${columns.userId} = ${userId}
          AND (${fingerprint}::text IS NULL
            OR ${columns.lastCodeHash} IS DISTINCT FROM ${fingerprint}
            OR ${columns.lastCodeAt} IS NULL
            OR ${columns.lastCodeAt} <= ${since}::timestamptz)
        RETURNING 1 AS claimed
      `);
      return firstRow(result) !== undefined;
    },

    async isCodeLocked(userId, now) {
      const result = await database.execute(sql`
        SELECT 1 AS locked FROM ${columns.table}
        WHERE ${columns.userId} = ${userId}
          AND ${columns.lockedUntil} > ${now.toISOString()}::timestamptz
      `);
      return firstRow(result) !== undefined;
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
