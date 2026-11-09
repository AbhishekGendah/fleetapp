import { MILLISECONDS_PER_MINUTE } from "@fleetapp/core";
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { MAX_FAILED_SIGN_INS, SIGN_IN_LOCKOUT_MINUTES } from "./login-policy";
import type { SignInLockoutStore } from "./sign-in-lockout";
import { columnName, firstRow, type SqlExecutor } from "./sql-helpers";

export type { SqlExecutor } from "./sql-helpers";

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

export function createDrizzleLockoutStore(
  database: SqlExecutor,
  columns: LockoutTable,
): SignInLockoutStore {
  const matchesLogin = (userId: string): SQL =>
    sql`${columns.userId} = ${userId} AND ${columns.providerId} = ${CREDENTIAL_PROVIDER_ID}`;

  const lockUntil = (now: Date): string =>
    new Date(now.getTime() + SIGN_IN_LOCKOUT_MINUTES * MILLISECONDS_PER_MINUTE).toISOString();

  return {
    // One statement, holding the account row, so attempts sent at the same
    // moment are counted one after another. An attempt is refused while the
    // login is locked or once five are in flight or failed. Finding five
    // unresolved (a server stopped mid-attempt) locks the login there and
    // then, so a stuck count heals into an ordinary lockout.
    async claimAttempt(userId, now) {
      const isLocked = sql`attempt_state.locked_until IS NOT NULL AND attempt_state.locked_until > ${now.toISOString()}::timestamptz`;
      const isOutOfAttempts = sql`attempt_state.failed >= ${MAX_FAILED_SIGN_INS}`;
      // FOR UPDATE on purpose ("Lock order", lock modes): one statement on the
      // login row, with nothing else in its transaction to wait for.
      /* eslint-disable no-restricted-syntax -- the sign-in lockout's single statement. */
      const result = await database.execute(sql`
        WITH attempt_state AS (
          SELECT ${columns.failedSignInCount} AS failed, ${columns.signInLockedUntil} AS locked_until
          FROM ${columns.table} WHERE ${matchesLogin(userId)} FOR UPDATE
        )
        UPDATE ${columns.table} SET
          ${columnName(columns.failedSignInCount)} = CASE
            WHEN ${isLocked} THEN attempt_state.failed
            WHEN ${isOutOfAttempts} THEN 0
            ELSE attempt_state.failed + 1 END,
          ${columnName(columns.signInLockedUntil)} = CASE
            WHEN ${isLocked} THEN attempt_state.locked_until
            WHEN ${isOutOfAttempts} THEN ${lockUntil(now)}::timestamptz
            ELSE attempt_state.locked_until END
        FROM attempt_state
        WHERE ${matchesLogin(userId)}
        RETURNING (${isLocked} OR ${isOutOfAttempts}) AS is_refused,
          (NOT (${isLocked}) AND ${isOutOfAttempts}) AS is_now_locked
      `);
      /* eslint-enable no-restricted-syntax */
      const row = firstRow(result);
      return { isAllowed: row?.is_refused !== true, isNowLocked: row?.is_now_locked === true };
    },

    // Locking resets the count, so the next five wrong guesses after it ends
    // lock the login again. Only the first wrong answer to reach the limit
    // locks it, so the lockout is logged once.
    async lockIfOutOfAttempts(userId, now) {
      const result = await database.execute(sql`
        UPDATE ${columns.table} SET
          ${columnName(columns.failedSignInCount)} = 0,
          ${columnName(columns.signInLockedUntil)} = ${lockUntil(now)}::timestamptz
        WHERE ${matchesLogin(userId)}
          AND ${columns.failedSignInCount} >= ${MAX_FAILED_SIGN_INS}
          AND (${columns.signInLockedUntil} IS NULL
               OR ${columns.signInLockedUntil} <= ${now.toISOString()}::timestamptz)
        RETURNING 1 AS locked
      `);
      return { isNowLocked: firstRow(result) !== undefined };
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
