import { recordActivity, type ActivityEntry } from "@fleetapp/db/activity";
import type { AnyTransaction } from "@fleetapp/db/client";

/**
 * Who is making a change: the signed-in User and their Operator, both from
 * the session, never from the form (rule 1). Every write logs it (rule 19).
 */
export interface ActingUser {
  userId: string;
  operatorId: string;
}

export type UserChange = Omit<ActivityEntry, "operatorId" | "actor">;

/** Logs a change the signed-in User made, inside the transaction that made it. */
export function recordUserChange(
  tx: AnyTransaction,
  actor: ActingUser,
  change: UserChange,
): Promise<void> {
  return recordActivity(tx, {
    operatorId: actor.operatorId,
    actor: { type: "user", id: actor.userId },
    ...change,
  });
}
