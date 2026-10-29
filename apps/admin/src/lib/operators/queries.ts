import {
  getInviteStatus,
  getOperatorStatus,
  type InviteStatus,
  type OperatorStatus,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  activityLog,
  files,
  operatorInvites,
  operators,
  users,
} from "@fleetapp/db/schema";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

/** Enough history to see what happened recently; the full log stays in the database. */
const OPERATOR_HISTORY_LIMIT = 50;

export interface OperatorSummary {
  id: string;
  legalName: string;
  tradingName: string | null;
  userEmail: string | null;
  status: OperatorStatus;
  /** When one of its Users last signed in. Null if none ever has. */
  lastSignedInAt: Date | null;
  /** Everything it has in storage, including deleted files not yet purged. */
  storageUsedBytes: number;
  createdAt: Date;
}

/**
 * Every Operator with its User and the state of its latest invite.
 *
 * TODO: paginate once there are enough Operators for it to matter; the
 * shared list component in Phase 1b brings paging, sorting and export.
 */
export async function listOperators(database: AnyDatabase, now: Date): Promise<OperatorSummary[]> {
  const [operatorRows, userRows, latestInvites, latestSignIns, storageRows] = await Promise.all([
    database.select().from(operators).orderBy(desc(operators.createdAt)),
    database
      .selectDistinctOn([users.operatorId], { operatorId: users.operatorId, email: users.email })
      .from(users)
      .orderBy(users.operatorId, asc(users.createdAt)),
    database
      .selectDistinctOn([operatorInvites.operatorId])
      .from(operatorInvites)
      .orderBy(operatorInvites.operatorId, desc(operatorInvites.createdAt)),
    database
      .selectDistinctOn([activityLog.operatorId], {
        operatorId: activityLog.operatorId,
        occurredAt: activityLog.occurredAt,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityType, ACTIVITY_ENTITY_TYPES.user),
          eq(activityLog.action, ACTIVITY_ACTIONS.signedIn),
        ),
      )
      .orderBy(activityLog.operatorId, desc(activityLog.occurredAt)),
    // Sizes only: the admin role cannot read what any file is (rule 5).
    database
      .select({
        operatorId: files.operatorId,
        bytes: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint`.mapWith(Number),
      })
      .from(files)
      .where(and(isNotNull(files.confirmedAt), isNull(files.purgedAt)))
      .groupBy(files.operatorId),
  ]);

  const lastSignInByOperator = new Map(
    latestSignIns.map((row) => [row.operatorId, row.occurredAt]),
  );
  const storageByOperator = new Map(storageRows.map((row) => [row.operatorId, row.bytes]));
  const emailByOperator = new Map(userRows.map((row) => [row.operatorId, row.email]));
  const inviteByOperator = new Map(latestInvites.map((invite) => [invite.operatorId, invite]));

  return operatorRows.map((operator) => ({
    id: operator.id,
    legalName: operator.legalName,
    tradingName: operator.tradingName,
    userEmail: emailByOperator.get(operator.id) ?? null,
    status: getOperatorStatus(
      {
        suspendedAt: operator.suspendedAt,
        latestInvite: inviteByOperator.get(operator.id) ?? null,
      },
      now,
    ),
    lastSignedInAt: lastSignInByOperator.get(operator.id) ?? null,
    storageUsedBytes: storageByOperator.get(operator.id) ?? 0,
    createdAt: operator.createdAt,
  }));
}

export interface InviteSummary {
  id: string;
  status: InviteStatus;
  createdAt: Date;
  expiresAt: Date;
  sentAt: Date | null;
}

export interface HistoryEntry {
  id: string;
  entityType: string;
  action: string;
  actorType: string;
  occurredAt: Date;
}

export interface OperatorDetail {
  id: string;
  legalName: string;
  tradingName: string | null;
  suspendedAt: Date | null;
  createdAt: Date;
  status: OperatorStatus;
  user: { fullName: string; email: string } | null;
  invites: InviteSummary[];
  history: HistoryEntry[];
}

export async function getOperatorDetail(
  database: AnyDatabase,
  operatorId: string,
  now: Date,
): Promise<OperatorDetail | null> {
  const [operator] = await database.select().from(operators).where(eq(operators.id, operatorId));
  if (!operator) {
    return null;
  }

  const [userRows, inviteRows, historyRows] = await Promise.all([
    database
      .select({ fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.operatorId, operatorId))
      .orderBy(asc(users.createdAt))
      .limit(1),
    database
      .select()
      .from(operatorInvites)
      .where(eq(operatorInvites.operatorId, operatorId))
      .orderBy(desc(operatorInvites.createdAt)),
    database
      .select({
        id: activityLog.id,
        entityType: activityLog.entityType,
        action: activityLog.action,
        actorType: activityLog.actorType,
        occurredAt: activityLog.occurredAt,
      })
      .from(activityLog)
      .where(eq(activityLog.operatorId, operatorId))
      .orderBy(desc(activityLog.occurredAt))
      .limit(OPERATOR_HISTORY_LIMIT),
  ]);

  return {
    id: operator.id,
    legalName: operator.legalName,
    tradingName: operator.tradingName,
    suspendedAt: operator.suspendedAt,
    createdAt: operator.createdAt,
    status: getOperatorStatus(
      { suspendedAt: operator.suspendedAt, latestInvite: inviteRows[0] ?? null },
      now,
    ),
    user: userRows[0] ?? null,
    invites: inviteRows.map((invite) => ({
      id: invite.id,
      status: getInviteStatus(invite, now),
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      sentAt: invite.sentAt,
    })),
    history: historyRows,
  };
}
