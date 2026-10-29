import type { AnyDatabase } from "./client";
import {
  activityLog,
  type ActivityAction,
  type ActivityEntityType,
  type ActorType,
} from "./schema";

/** A database or a transaction: anything that can add a row. */
type ActivityWriter = Pick<AnyDatabase, "insert">;

export interface ActivityEntry {
  operatorId: string;
  /** Who did it (rule 19). `id` is null for `system`, which has no person. */
  actor: { type: ActorType; id: string | null };
  entityType: ActivityEntityType;
  entityId: string;
  action: ActivityAction;
  /** Only the fields that changed. Never a password, code or token (rule 7). */
  valuesBefore?: Record<string, unknown>;
  valuesAfter?: Record<string, unknown>;
}

/**
 * Writes one line of an Operator's history. Pass the transaction that makes
 * the change, so a change can never happen without its log line.
 */
export async function recordActivity(writer: ActivityWriter, entry: ActivityEntry): Promise<void> {
  await writer.insert(activityLog).values({
    operatorId: entry.operatorId,
    actorType: entry.actor.type,
    actorId: entry.actor.id,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    valuesBefore: entry.valuesBefore ?? null,
    valuesAfter: entry.valuesAfter ?? null,
  });
}
