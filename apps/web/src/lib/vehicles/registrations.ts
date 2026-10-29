import type { AnyDatabase } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, vehicleRegistrations } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { findCurrentVehicle } from "./current-vehicle";
import type { RegoInput } from "./paperwork-input";

export type AddRegistrationResult =
  { status: "added"; isEarlierThanCurrent: boolean } | { status: "not_found" };

/**
 * Records a rego renewal. One that expires before the car's current rego is
 * saved but flagged: it is probably an old one being entered late, or a typo.
 */
export async function addRegistration(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
  input: RegoInput,
): Promise<AddRegistrationResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await findCurrentVehicle(tx, actor.operatorId, vehicleId))) {
      return { status: "not_found" };
    }
    const [current] = await tx
      .select({ expiresOn: vehicleRegistrations.expiresOn })
      .from(vehicleRegistrations)
      .where(
        and(eq(vehicleRegistrations.vehicleId, vehicleId), isNull(vehicleRegistrations.archivedAt)),
      )
      .orderBy(desc(vehicleRegistrations.expiresOn))
      .limit(1);
    const [added] = await tx
      .insert(vehicleRegistrations)
      .values({ ...input, operatorId: actor.operatorId, vehicleId })
      .returning({ id: vehicleRegistrations.id });
    if (!added) {
      throw new Error("The rego renewal was not saved.");
    }
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.vehicleRegistration,
      entityId: added.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: { vehicleId, ...input },
    });
    return {
      status: "added",
      isEarlierThanCurrent: current !== undefined && input.expiresOn < current.expiresOn,
    };
  });
}

/** Hides a renewal entered by mistake. It stays on record (rule 13). */
export async function archiveRegistration(
  database: AnyDatabase,
  actor: ActingUser,
  registrationId: string,
): Promise<"archived" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [archived] = await tx
      .update(vehicleRegistrations)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(vehicleRegistrations.id, registrationId),
          eq(vehicleRegistrations.operatorId, actor.operatorId),
          isNull(vehicleRegistrations.archivedAt),
        ),
      )
      .returning({ id: vehicleRegistrations.id });
    if (!archived) {
      return "not_found";
    }
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.vehicleRegistration,
      entityId: registrationId,
      action: ACTIVITY_ACTIONS.archived,
    });
    return "archived";
  });
}
