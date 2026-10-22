import { sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  MAX_FAILED_SIGN_INS,
  SIGN_IN_LOCKOUT_MINUTES,
  type SignInLockoutStore,
} from "./sign-in-lockout";

const MILLISECONDS_PER_MINUTE = 60 * 1000;

/** Only the password login is locked; it is the only kind there is in v1. */
const CREDENTIAL_PROVIDER_ID = "credential";

/** The account table and columns to keep the count in: `admin_accounts` or `user_accounts`. */
export interface LockoutTable {
  table: PgTable;
  userId: PgColumn;
  providerId: PgColumn;
  failedSignInCount: PgColumn;
  signInLockedUntil: PgColumn;
}

/** All this needs of a database: running raw SQL. Both drivers in use qualify. */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** A SET clause takes a bare column name; Drizzle would otherwise qualify it. */
function columnName(column: PgColumn): SQL {
  return sql`${sql.identifier(column.name)}`;
}

/** Both the Neon and node-postgres drivers return rows under `rows`. */
function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (typeof result !== "object" || result === null) {
    return undefined;
  }
  const rows: unknown = Reflect.get(result, "rows");
  if (!Array.isArray(rows)) {
    return undefined;
  }
  const [row]: unknown[] = rows;
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>) : undefined;
}

function parseTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  return typeof value === "string" ? new Date(value) : null;
}

export function createDrizzleLockoutStore(
  database: SqlExecutor,
  columns: LockoutTable,
): SignInLockoutStore {
  const matchesLogin = (userId: string): SQL =>
    sql`${columns.userId} = ${userId} AND ${columns.providerId} = ${CREDENTIAL_PROVIDER_ID}`;

  return {
    async findLockedUntil(userId) {
      const result = await database.execute(sql`
        SELECT ${columns.signInLockedUntil} AS locked_until FROM ${columns.table}
        WHERE ${matchesLogin(userId)}
      `);
      return parseTimestamp(firstRow(result)?.locked_until);
    },

    // One statement, so two wrong guesses at the same moment are both counted.
    // Reaching the limit starts the lockout and resets the count, so the next
    // five wrong guesses after it ends lock the login again.
    async recordFailure(userId, now) {
      const lockedUntil = new Date(
        now.getTime() + SIGN_IN_LOCKOUT_MINUTES * MILLISECONDS_PER_MINUTE,
      );
      const reachesLimit = sql`${columns.failedSignInCount} + 1 >= ${MAX_FAILED_SIGN_INS}`;
      const result = await database.execute(sql`
        UPDATE ${columns.table} SET
          ${columnName(columns.failedSignInCount)} =
            CASE WHEN ${reachesLimit} THEN 0 ELSE ${columns.failedSignInCount} + 1 END,
          ${columnName(columns.signInLockedUntil)} =
            CASE WHEN ${reachesLimit} THEN ${lockedUntil.toISOString()}::timestamptz
                 ELSE ${columns.signInLockedUntil} END
        WHERE ${matchesLogin(userId)}
        RETURNING ${columns.signInLockedUntil} AS locked_until
      `);
      const newLockedUntil = parseTimestamp(firstRow(result)?.locked_until);
      return { isNowLocked: newLockedUntil !== null && newLockedUntil.getTime() > now.getTime() };
    },

    async clearFailures(userId) {
      await database.execute(sql`
        UPDATE ${columns.table} SET
          ${columnName(columns.failedSignInCount)} = 0,
          ${columnName(columns.signInLockedUntil)} = NULL
        WHERE ${matchesLogin(userId)}
          AND (${columns.failedSignInCount} <> 0 OR ${columns.signInLockedUntil} IS NOT NULL)
      `);
    },
  };
}
