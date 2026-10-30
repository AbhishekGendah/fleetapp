import type { AnyDatabase } from "./client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
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

/** What each kind of record is called in a history list. A new kind fails to compile until it has one. */
const ACTIVITY_ENTITY_LABELS = {
  [ACTIVITY_ENTITY_TYPES.operator]: "Operator",
  [ACTIVITY_ENTITY_TYPES.user]: "User",
  [ACTIVITY_ENTITY_TYPES.operatorInvite]: "Invite",
  [ACTIVITY_ENTITY_TYPES.operatorSettings]: "Settings",
  [ACTIVITY_ENTITY_TYPES.file]: "File",
  [ACTIVITY_ENTITY_TYPES.vehicle]: "Car",
  [ACTIVITY_ENTITY_TYPES.odometerReading]: "Odometer reading",
  [ACTIVITY_ENTITY_TYPES.vehicleRegistration]: "Rego renewal",
  [ACTIVITY_ENTITY_TYPES.insurancePolicy]: "Insurance policy",
  [ACTIVITY_ENTITY_TYPES.vehiclePurchase]: "Purchase",
  [ACTIVITY_ENTITY_TYPES.vehicleSale]: "Sale",
  [ACTIVITY_ENTITY_TYPES.vehicleCost]: "Cost",
  [ACTIVITY_ENTITY_TYPES.renter]: "Renter",
} satisfies Record<ActivityEntityType, string>;

/** What each action reads as after the record's name: "Car archived". */
const ACTIVITY_ACTION_LABELS = {
  [ACTIVITY_ACTIONS.created]: "added",
  [ACTIVITY_ACTIONS.sent]: "sent",
  [ACTIVITY_ACTIONS.revoked]: "cancelled",
  [ACTIVITY_ACTIONS.suspended]: "suspended",
  [ACTIVITY_ACTIONS.reactivated]: "reactivated",
  [ACTIVITY_ACTIONS.accepted]: "accepted",
  [ACTIVITY_ACTIONS.signedIn]: "signed in",
  [ACTIVITY_ACTIONS.signInFailed]: "sign-in failed",
  [ACTIVITY_ACTIONS.lockedOut]: "locked out",
  [ACTIVITY_ACTIONS.twoFactorEnrolled]: "authenticator set up",
  [ACTIVITY_ACTIONS.passwordReset]: "password reset",
  [ACTIVITY_ACTIONS.updated]: "changed",
  [ACTIVITY_ACTIONS.uploaded]: "uploaded",
  [ACTIVITY_ACTIONS.viewed]: "opened",
  [ACTIVITY_ACTIONS.refused]: "refused",
  [ACTIVITY_ACTIONS.deleted]: "deleted",
  [ACTIVITY_ACTIONS.purged]: "removed for good",
  [ACTIVITY_ACTIONS.archived]: "archived",
  [ACTIVITY_ACTIONS.restored]: "restored",
  [ACTIVITY_ACTIONS.statusChanged]: "status changed",
  [ACTIVITY_ACTIONS.withdrawn]: "withdrawn",
  [ACTIVITY_ACTIONS.vehicleAdded]: "car added",
  [ACTIVITY_ACTIONS.vehicleRemoved]: "car taken off",
  [ACTIVITY_ACTIONS.cancelled]: "cancelled",
  [ACTIVITY_ACTIONS.exported]: "list downloaded",
} satisfies Record<ActivityAction, string>;

function labelFor(labels: Readonly<Record<string, string>>, key: string): string {
  return Object.hasOwn(labels, key) ? labels[key]! : key;
}

/** One line of history in words, e.g. "Car status changed". Unknown values are shown as stored. */
export function describeActivity(entityType: string, action: string): string {
  return `${labelFor(ACTIVITY_ENTITY_LABELS, entityType)} ${labelFor(ACTIVITY_ACTION_LABELS, action)}`;
}
