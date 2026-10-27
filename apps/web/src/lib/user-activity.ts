import type { AnyDatabase } from "@fleetapp/db/client";
import { ACTIVITY_ENTITY_TYPES, type ActivityAction, type ActorType } from "@fleetapp/db/schema";
import { sql } from "drizzle-orm";

export interface UserActivityEntry {
  userId: string;
  action: ActivityAction;
  /** `user` when the User did it; `system` for a failed attempt, which could be anyone. */
  actorType: Extract<ActorType, "user" | "system">;
}

/**
 * One line of the Operator's history about a User's login.
 *
 * The login system knows the User but not their Operator, so the Operator is
 * read from the User in the same statement rather than trusted from anywhere
 * else. Never pass a password, code or token here (rule 7).
 */
export async function recordUserActivity(
  database: AnyDatabase,
  entry: UserActivityEntry,
): Promise<void> {
  const actorId = entry.actorType === "user" ? entry.userId : null;
  await database.execute(sql`
    INSERT INTO activity_log (operator_id, actor_type, actor_id, entity_type, entity_id, action)
    SELECT operator_id, ${entry.actorType}, ${actorId}::uuid, ${ACTIVITY_ENTITY_TYPES.user}, id,
           ${entry.action}
    FROM users WHERE id = ${entry.userId}
  `);
}

/** The shape the login system logs through: failures here never block a sign-in. */
export type RecordUserActivity = (
  userId: string,
  action: ActivityAction,
  actorType: UserActivityEntry["actorType"],
) => Promise<void>;
