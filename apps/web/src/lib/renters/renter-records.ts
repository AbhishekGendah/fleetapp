import { changedValues, hasChanges, withholdChangedFields, withholdFields } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  renters,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser, type UserChange } from "../acting-user";
import type { RenterInput, RenterStatusInput } from "./renter-input";

/** Every detail the form sets. All personal, so the log only says which changed. */
const RENTER_FIELDS = [
  "fullName",
  "preferredName",
  "phone",
  "email",
  "dateOfBirth",
  "residentialAddress",
  "postalAddress",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelationship",
] as const satisfies readonly (keyof RenterInput)[];

const STATUS_FIELDS = ["status", "doNotRentReason"] as const;
/** The status itself is logged; the reason is the Operator's private note. */
const PRIVATE_STATUS_FIELDS = ["doNotRentReason"] as const;

type Renter = typeof renters.$inferSelect;

/** Archived Renters are read-only until restored, as for cars. */
export type ChangeRenterResult = "changed" | "unchanged" | "not_found";

function logRenterActivity(
  tx: AnyTransaction,
  actor: ActingUser,
  renterId: string,
  action: ActivityAction,
  values: Pick<UserChange, "valuesBefore" | "valuesAfter"> = {},
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.renter,
    entityId: renterId,
    action,
    ...values,
  });
}

/** The Operator's Renter, locked for this transaction, if they are theirs and not archived. */
async function lockCurrentRenter(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<Renter | undefined> {
  const [renter] = await tx
    .select()
    .from(renters)
    .where(
      and(eq(renters.id, renterId), eq(renters.operatorId, operatorId), isNull(renters.archivedAt)),
    )
    .for("update");
  return renter;
}

/** Adds a Renter to the signed-in User's Operator (never one named by the form: rule 1). */
export async function createRenter(
  database: AnyDatabase,
  actor: ActingUser,
  input: RenterInput,
): Promise<string> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [created] = await tx
      .insert(renters)
      .values({ ...input, operatorId: actor.operatorId })
      .returning({ id: renters.id });
    if (!created) {
      throw new Error("The Renter was not saved.");
    }
    await logRenterActivity(tx, actor, created.id, ACTIVITY_ACTIONS.created, {
      valuesAfter: withholdFields(input, RENTER_FIELDS),
    });
    return created.id;
  });
}

/** Saves the edit form. The log names the details that changed, never their values. */
export async function updateRenter(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
  input: RenterInput,
): Promise<ChangeRenterResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const before = await lockCurrentRenter(tx, actor.operatorId, renterId);
    if (!before) {
      return "not_found";
    }
    const changes = changedValues(before, input, RENTER_FIELDS);
    if (!hasChanges(changes)) {
      return "unchanged";
    }
    await tx.update(renters).set(input).where(eq(renters.id, renterId));
    await logRenterActivity(
      tx,
      actor,
      renterId,
      ACTIVITY_ACTIONS.updated,
      withholdChangedFields(changes, RENTER_FIELDS),
    );
    return "changed";
  });
}

/** Active, or Do not rent with a reason. */
export async function changeRenterStatus(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
  input: RenterStatusInput,
): Promise<ChangeRenterResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const before = await lockCurrentRenter(tx, actor.operatorId, renterId);
    if (!before) {
      return "not_found";
    }
    const changes = changedValues(before, input, STATUS_FIELDS);
    if (!hasChanges(changes)) {
      return "unchanged";
    }
    await tx.update(renters).set(input).where(eq(renters.id, renterId));
    await logRenterActivity(
      tx,
      actor,
      renterId,
      ACTIVITY_ACTIONS.statusChanged,
      withholdChangedFields(changes, PRIVATE_STATUS_FIELDS),
    );
    return "changed";
  });
}

/** Hides a Renter from the list, keeping everything (rule 13), or brings one back. */
async function setRenterArchived(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
  shouldArchive: boolean,
): Promise<ChangeRenterResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [changed] = await tx
      .update(renters)
      .set({ archivedAt: shouldArchive ? new Date() : null })
      .where(
        and(
          eq(renters.id, renterId),
          eq(renters.operatorId, actor.operatorId),
          shouldArchive ? isNull(renters.archivedAt) : isNotNull(renters.archivedAt),
        ),
      )
      .returning({ id: renters.id });
    if (!changed) {
      return "unchanged";
    }
    const action = shouldArchive ? ACTIVITY_ACTIONS.archived : ACTIVITY_ACTIONS.restored;
    await logRenterActivity(tx, actor, renterId, action);
    return "changed";
  });
}

export function archiveRenter(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
): Promise<ChangeRenterResult> {
  return setRenterArchived(database, actor, renterId, true);
}

export function restoreRenter(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
): Promise<ChangeRenterResult> {
  return setRenterArchived(database, actor, renterId, false);
}
