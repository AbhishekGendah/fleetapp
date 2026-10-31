import type { AnyDatabase } from "@fleetapp/db/client";
import { activityLog, users, type ActivityEntityType, type ActorType } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, inArray, or } from "drizzle-orm";

/** Enough to see what happened recently; the full log stays in the database. */
const HISTORY_LIMIT = 100;

export interface HistoryEntry {
  id: string;
  entityType: string;
  action: string;
  actorType: ActorType;
  /** The User's name when a User did it. */
  actorName: string | null;
  occurredAt: Date;
  valuesBefore: Record<string, unknown> | null;
  valuesAfter: Record<string, unknown> | null;
}

/** The records whose history to show together, e.g. a car and its odometer readings. */
export interface HistorySubject {
  entityType: ActivityEntityType;
  entityIds: readonly string[];
}

function asValues(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A record's history tab (rule 19), newest first, within the signed-in
 * User's Operator. The latest lines only, unless everything is asked for
 * (a Renter's "everything we hold" download).
 */
export async function loadRecordHistory(
  database: AnyDatabase,
  operatorId: string,
  subjects: readonly HistorySubject[],
  { isEverything = false }: { isEverything?: boolean } = {},
): Promise<HistoryEntry[]> {
  const bySubject = subjects
    .filter((subject) => subject.entityIds.length > 0)
    .map((subject) =>
      and(
        eq(activityLog.entityType, subject.entityType),
        inArray(activityLog.entityId, [...subject.entityIds]),
      ),
    );
  if (bySubject.length === 0) {
    return [];
  }
  const rows = await withTenant(database, operatorId, (tx) => {
    const query = tx
      .select({
        id: activityLog.id,
        entityType: activityLog.entityType,
        action: activityLog.action,
        actorType: activityLog.actorType,
        actorName: users.fullName,
        occurredAt: activityLog.occurredAt,
        valuesBefore: activityLog.valuesBefore,
        valuesAfter: activityLog.valuesAfter,
      })
      .from(activityLog)
      .leftJoin(users, and(eq(activityLog.actorType, "user"), eq(users.id, activityLog.actorId)))
      .where(and(eq(activityLog.operatorId, operatorId), or(...bySubject)))
      .orderBy(desc(activityLog.occurredAt));
    return isEverything ? query : query.limit(HISTORY_LIMIT);
  });
  return rows.map((row) => ({
    ...row,
    valuesBefore: asValues(row.valuesBefore),
    valuesAfter: asValues(row.valuesAfter),
  }));
}
