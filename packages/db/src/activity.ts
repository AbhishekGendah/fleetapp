import type { FilePurpose } from "@fleetapp/core";

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
  [ACTIVITY_ENTITY_TYPES.renterNote]: "Note",
  [ACTIVITY_ENTITY_TYPES.renterLink]: "Details form link",
  [ACTIVITY_ENTITY_TYPES.rental]: "Rental",
  [ACTIVITY_ENTITY_TYPES.contractTemplate]: "Contract template",
  [ACTIVITY_ENTITY_TYPES.issuedDocument]: "Document",
  [ACTIVITY_ENTITY_TYPES.bondMovement]: "Bond entry",
  [ACTIVITY_ENTITY_TYPES.inspection]: "Checklist",
  [ACTIVITY_ENTITY_TYPES.damageMark]: "Damage mark",
  [ACTIVITY_ENTITY_TYPES.damageRecord]: "Damage",
  [ACTIVITY_ENTITY_TYPES.insuranceClaim]: "Insurance claim",
  [ACTIVITY_ENTITY_TYPES.rentalChange]: "Change of terms",
  [ACTIVITY_ENTITY_TYPES.carSwap]: "Car swap",
  [ACTIVITY_ENTITY_TYPES.chargeType]: "Charge type",
  [ACTIVITY_ENTITY_TYPES.ledgerLine]: "Ledger line",
  [ACTIVITY_ENTITY_TYPES.billingDocument]: "Invoice or receipt",
  [ACTIVITY_ENTITY_TYPES.documentNumbering]: "Invoice numbering",
  [ACTIVITY_ENTITY_TYPES.stripeAccount]: "Stripe account",
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
  [ACTIVITY_ACTIONS.exportedAll]: "everything held downloaded",
  [ACTIVITY_ACTIONS.codeSent]: "code emailed",
  [ACTIVITY_ACTIONS.phoneVerified]: "opened on a new phone",
  [ACTIVITY_ACTIONS.locked]: "locked after too many wrong codes",
  [ACTIVITY_ACTIONS.submitted]: "details sent for review",
  [ACTIVITY_ACTIONS.approved]: "details sent by the Renter approved",
  [ACTIVITY_ACTIONS.sentBack]: "details sent back to the Renter for changes",
  [ACTIVITY_ACTIONS.submissionRemoved]: "details sent through the link removed",
  [ACTIVITY_ACTIONS.signed]: "signed",
} satisfies Record<ActivityAction, string>;

function labelFor(labels: Readonly<Record<string, string>>, key: string): string {
  return Object.hasOwn(labels, key) ? labels[key]! : key;
}

/** What a file is called in a history list, by what it is for: "Licence scan opened". */
const FILE_PURPOSE_LABELS = {
  operator_logo: "Logo",
  vehicle_photo: "Photo",
  vehicle_photo_thumbnail: "Photo's small copy",
  vehicle_document: "Document",
  vehicle_attachment: "Attachment",
  vehicle_identity_attachment: "Private paper",
  renter_licence_scan: "Licence scan",
  renter_submitted_scan: "Licence photo sent by the Renter",
  issued_document: "Issued document",
} satisfies Record<FilePurpose, string>;

/** Why the nightly clean-up removed a file, as its log line says. */
const SYSTEM_BIN_REASON_LABELS: Readonly<Record<string, string>> = {
  kept_the_set_time: "after the set number of months",
  link_ended_over_30_days: "30 days after its link ended",
};

/** A text value from a log line's values, e.g. a file's purpose; null if absent. */
function textValueOf(values: unknown, key: string): string | null {
  if (typeof values !== "object" || values === null) {
    return null;
  }
  const value: unknown = Reflect.get(values, key);
  return typeof value === "string" ? value : null;
}

/**
 * One line of history in words, e.g. "Car status changed", or for a file
 * what it is ("Licence scan opened") when its log line says. Unknown values
 * are shown as stored.
 */
export function describeActivity(
  entityType: string,
  action: string,
  valuesAfter?: unknown,
): string {
  const isFile = entityType === ACTIVITY_ENTITY_TYPES.file;
  const purpose = isFile ? textValueOf(valuesAfter, "purpose") : null;
  const reason = isFile ? textValueOf(valuesAfter, "reason") : null;
  const subject =
    purpose && Object.hasOwn(FILE_PURPOSE_LABELS, purpose)
      ? labelFor(FILE_PURPOSE_LABELS, purpose)
      : labelFor(ACTIVITY_ENTITY_LABELS, entityType);
  const why =
    reason && Object.hasOwn(SYSTEM_BIN_REASON_LABELS, reason)
      ? ` ${SYSTEM_BIN_REASON_LABELS[reason]}`
      : "";
  return `${subject} ${labelFor(ACTIVITY_ACTION_LABELS, action)}${why}`;
}
