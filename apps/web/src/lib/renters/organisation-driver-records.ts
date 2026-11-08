import { driverToAddProblem, type DriverToAddProblem } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  organisationDrivers,
  rentals,
  renters,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import type { RenterInput } from "./renter-input";
import { insertRenter, lockCurrentRenter } from "./renter-records";

/**
 * Adding and removing a business Renter's drivers (plan slice 2, Drivers
 * tab). Locks are taken in the order a booking takes them (business, then
 * driver, then the link: slice 1 review F2), so the two never wait on each
 * other in a circle; the database's own triggers hold the same rules.
 */

export type AddDriverResult =
  | { status: "added"; driverId: string }
  | { status: "business_not_found" }
  | { status: "driver_not_found" }
  | { status: "refused"; problem: DriverToAddProblem };

export type RemoveDriverResult = "removed" | "not_found" | "named_on_rental";

/** What a draft, booking or car out of the business is, for "named on a rental". */
const NAMING_STATUSES = ["draft", "booked", "active"] as const;

function logLink(
  tx: AnyTransaction,
  actor: ActingUser,
  linkId: string,
  action: ActivityAction,
  link: { organisationId: string; driverId: string },
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.organisationDriver,
    entityId: linkId,
    action,
    valuesAfter: { organisationId: link.organisationId, driverId: link.driverId },
  });
}

const PERSON_COLUMNS = {
  id: renters.id,
  kind: renters.kind,
  status: renters.status,
  archivedAt: renters.archivedAt,
  retiredAt: renters.retiredAt,
};

/** The Operator's current business Renter, locked first (it comes first in every lock order). */
async function lockBusiness(tx: AnyTransaction, operatorId: string, organisationId: string) {
  const locked = await lockCurrentRenter(tx, operatorId, organisationId);
  return locked?.kind === "organisation" ? locked : undefined;
}

/**
 * The Operator's Renter, archived ones too (so the refusal can say why),
 * locked after the business if a person. A business is read but never
 * locked: two crossed adds (each business named as the other's driver)
 * would otherwise lock in opposite orders and wait on each other for ever.
 * A Renter's kind never changes, so the unlocked read stays true.
 */
async function lockPerson(tx: AnyTransaction, operatorId: string, renterId: string) {
  const which = and(eq(renters.id, renterId), eq(renters.operatorId, operatorId));
  const [person] = await tx
    .select(PERSON_COLUMNS)
    .from(renters)
    // A row the filter leaves out is never locked.
    .where(and(which, eq(renters.kind, "person")))
    .for("update");
  if (person) {
    return person;
  }
  const [other] = await tx.select(PERSON_COLUMNS).from(renters).where(which);
  return other;
}

async function currentLinkOf(
  tx: AnyTransaction,
  operatorId: string,
  organisationId: string,
  driverId: string,
  shouldLock: boolean,
) {
  const query = tx
    .select({ id: organisationDrivers.id })
    .from(organisationDrivers)
    .where(
      and(
        eq(organisationDrivers.operatorId, operatorId),
        eq(organisationDrivers.organisationId, organisationId),
        eq(organisationDrivers.driverId, driverId),
        isNull(organisationDrivers.removedAt),
      ),
    );
  const [link] = shouldLock ? await query.for("update") : await query;
  return link;
}

/** Links an already locked business and person, after the rules (core) say yes. */
async function linkDriver(
  tx: AnyTransaction,
  actor: ActingUser,
  organisationId: string,
  driverId: string,
): Promise<AddDriverResult> {
  const person = await lockPerson(tx, actor.operatorId, driverId);
  if (!person) {
    return { status: "driver_not_found" };
  }
  const problem = driverToAddProblem({
    kind: person.kind,
    status: person.status,
    isArchived: person.archivedAt !== null,
    isRetired: person.retiredAt !== null,
    isCurrentDriver:
      (await currentLinkOf(tx, actor.operatorId, organisationId, driverId, false)) !== undefined,
  });
  if (problem) {
    return { status: "refused", problem };
  }
  const [link] = await tx
    .insert(organisationDrivers)
    .values({
      operatorId: actor.operatorId,
      organisationId,
      driverId,
      addedByUserId: actor.userId,
    })
    .returning({ id: organisationDrivers.id });
  if (!link) {
    throw new Error("The driver was not saved.");
  }
  await logLink(tx, actor, link.id, ACTIVITY_ACTIONS.created, { organisationId, driverId });
  return { status: "added", driverId };
}

/** Makes one of the Operator's person Renters a driver of the business. */
export async function addExistingDriver(
  database: AnyDatabase,
  actor: ActingUser,
  organisationId: string,
  driverId: string,
): Promise<AddDriverResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await lockBusiness(tx, actor.operatorId, organisationId))) {
      return { status: "business_not_found" };
    }
    return linkDriver(tx, actor, organisationId, driverId);
  });
}

/**
 * Adds someone new as a person Renter (a name and a phone or email; they
 * fill in the rest through their details link) and makes them the
 * business's driver, in one step: either both are saved or neither.
 */
export async function addNewDriver(
  database: AnyDatabase,
  actor: ActingUser,
  organisationId: string,
  input: RenterInput,
): Promise<AddDriverResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await lockBusiness(tx, actor.operatorId, organisationId))) {
      return { status: "business_not_found" };
    }
    const driverId = await insertRenter(tx, actor, input);
    const result = await linkDriver(tx, actor, organisationId, driverId);
    if (result.status !== "added") {
      // A person just added always qualifies; anything else undoes both.
      throw new Error("A new driver could not be linked to the business.");
    }
    return result;
  });
}

/**
 * Ends a driver's link to the business, keeping it as history (rule 13).
 * Refused while a draft, booking or car out of the business names them: the
 * car would go, or stay, with someone who no longer drives for it.
 */
export async function removeDriver(
  database: AnyDatabase,
  actor: ActingUser,
  organisationId: string,
  driverId: string,
): Promise<RemoveDriverResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await lockBusiness(tx, actor.operatorId, organisationId))) {
      return "not_found";
    }
    const person = await lockPerson(tx, actor.operatorId, driverId);
    if (person?.kind !== "person") {
      return "not_found";
    }
    const link = await currentLinkOf(tx, actor.operatorId, organisationId, driverId, true);
    if (!link) {
      return "not_found";
    }
    const [named] = await tx
      .select({ id: rentals.id })
      .from(rentals)
      .where(
        and(
          eq(rentals.operatorId, actor.operatorId),
          eq(rentals.renterId, organisationId),
          eq(rentals.driverId, driverId),
          inArray(rentals.status, [...NAMING_STATUSES]),
        ),
      )
      .limit(1);
    if (named) {
      return "named_on_rental";
    }
    // The database stamps its own time on it: the end starts the seven-year clock.
    const now = new Date();
    await tx
      .update(organisationDrivers)
      .set({ removedAt: now, removedByUserId: actor.userId, updatedAt: now })
      .where(eq(organisationDrivers.id, link.id));
    await logLink(tx, actor, link.id, ACTIVITY_ACTIONS.removed, { organisationId, driverId });
    return "removed";
  });
}
