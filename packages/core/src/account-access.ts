/** The dates that decide whether a User's login may be used. */
export interface AccountStanding {
  userArchivedAt: Date | null;
  operatorSuspendedAt: Date | null;
  operatorArchivedAt: Date | null;
}

/**
 * - `open`: may sign in and use the app.
 * - `suspended`: AGS has suspended the Operator; the User sees only the
 *   suspended page until reactivated.
 * - `closed`: the User or the Operator is archived; no way in at all.
 */
export type AccountAccess = "open" | "suspended" | "closed";

/** Archived wins over suspended: an archived account is never reopened by reactivating. */
export function getAccountAccess(standing: AccountStanding): AccountAccess {
  if (standing.userArchivedAt || standing.operatorArchivedAt) {
    return "closed";
  }
  return standing.operatorSuspendedAt ? "suspended" : "open";
}
