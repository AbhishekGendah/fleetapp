import {
  getInviteStatus,
  getOperatorStatus,
  type InviteStatus,
  type OperatorStatus,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import type { ActorType } from "@fleetapp/db/schema";
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

/**
 * The latest lines the Log page lists, a page at a time (Abhi's A6); older
 * ones stay in the database.
 */
export const OPERATOR_HISTORY_LIMIT = 1000;

/** A User of the Operator signing in. */
const SIGNED_IN = and(
  eq(activityLog.entityType, ACTIVITY_ENTITY_TYPES.user),
  eq(activityLog.action, ACTIVITY_ACTIONS.signedIn),
);
/** Files that take up storage: uploaded and not yet purged, deleted or not. */
const STORED_FILE = and(isNotNull(files.confirmedAt), isNull(files.purgedAt));
// Sizes only: the admin role cannot read what any file is (rule 5).
const STORED_BYTES = sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint`.mapWith(Number);

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
  /** Whether it has entered its business details (the ABN is the one they all need). */
  hasBusinessDetails: boolean;
  /** Whether Stripe lets it take payments yet. */
  isStripeReady: boolean;
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
      .where(SIGNED_IN)
      .orderBy(activityLog.operatorId, desc(activityLog.occurredAt)),
    database
      .select({ operatorId: files.operatorId, bytes: STORED_BYTES })
      .from(files)
      .where(STORED_FILE)
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
    hasBusinessDetails: Boolean(operator.abn),
    isStripeReady: operator.stripeChargesEnabled,
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
  actorType: ActorType;
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
  /** Setup, as the Operator's own checklist sees it (Abhi's A7). */
  hasBusinessDetails: boolean;
  isStripeReady: boolean;
  isStripePayoutReady: boolean;
  /** Stripe's word for the direct-debit capability, e.g. "active"; null if not asked for yet. */
  becsStatus: string | null;
  lastSignedInAt: Date | null;
  storageUsedBytes: number;
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

  const [userRows, inviteRows, historyRows, signInRows, storageRows] = await Promise.all([
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
    database
      .select({ occurredAt: activityLog.occurredAt })
      .from(activityLog)
      .where(and(eq(activityLog.operatorId, operatorId), SIGNED_IN))
      .orderBy(desc(activityLog.occurredAt))
      .limit(1),
    database
      .select({ bytes: STORED_BYTES })
      .from(files)
      .where(and(eq(files.operatorId, operatorId), STORED_FILE)),
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
    hasBusinessDetails: Boolean(operator.abn),
    isStripeReady: operator.stripeChargesEnabled,
    isStripePayoutReady: operator.stripePayoutsEnabled,
    becsStatus: operator.stripeBecsCapabilityStatus,
    lastSignedInAt: signInRows[0]?.occurredAt ?? null,
    storageUsedBytes: storageRows[0]?.bytes ?? 0,
  };
}
