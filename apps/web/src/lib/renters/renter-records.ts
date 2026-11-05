import { changedValues, hasChanges, withholdChangedFields, withholdFields } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  renterStripeCustomers,
  renters,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser, type UserChange } from "../acting-user";
import { cancelLiveLinks } from "../renter-links/cancel-links";
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

export function logRenterActivity(
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

/**
 * The Operator's Renter, locked for this transaction, if they are theirs and
 * not archived. A Renter whose details were removed (seven years on) is
 * always archived, so is never returned.
 */
export async function lockCurrentRenter(
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

/** The Renter's details Stripe keeps its own copy of. */
const STRIPE_CUSTOMER_FIELDS = ["fullName", "email"] as const;

/**
 * Writes a Renter's details onto the locked record `before`, logging which
 * changed but never their values. Shared by the edit form and approving
 * what the Renter sent.
 */
export async function applyRenterDetails(
  tx: AnyTransaction,
  actor: ActingUser,
  before: Renter,
  input: RenterInput,
): Promise<"changed" | "unchanged"> {
  const changes = changedValues(before, input, RENTER_FIELDS);
  if (!hasChanges(changes)) {
    return "unchanged";
  }
  // Only the form's own fields, whatever else the object carries.
  const details = Object.fromEntries(RENTER_FIELDS.map((field) => [field, input[field]]));
  await tx
    .update(renters)
    .set(details)
    .where(and(eq(renters.id, before.id), eq(renters.operatorId, actor.operatorId)));
  // Codes go to the address a link was sent to: a corrected email must not
  // leave a link open to the old (perhaps someone else's) inbox.
  if (Object.hasOwn(changes.valuesAfter, "email")) {
    await cancelLiveLinks(tx, actor, before.id, new Date());
  }
  // Stripe sends direct-debit notices to its own copy: it is told after the save (review A5-6).
  if (STRIPE_CUSTOMER_FIELDS.some((field) => Object.hasOwn(changes.valuesAfter, field))) {
    await tx
      .update(renterStripeCustomers)
      .set({ needsUpdate: true })
      .where(
        and(
          eq(renterStripeCustomers.operatorId, actor.operatorId),
          eq(renterStripeCustomers.renterId, before.id),
        ),
      );
  }
  await logRenterActivity(
    tx,
    actor,
    before.id,
    ACTIVITY_ACTIONS.updated,
    withholdChangedFields(changes, RENTER_FIELDS),
  );
  return "changed";
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
    return before ? applyRenterDetails(tx, actor, before, input) : "not_found";
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
          // Their details are gone: they are kept as the retention job left them.
          isNull(renters.retiredAt),
        ),
      )
      .returning({ id: renters.id });
    if (!changed) {
      return "unchanged";
    }
    if (shouldArchive) {
      await cancelLiveLinks(tx, actor, renterId, new Date());
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
