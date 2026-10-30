import { isDirectDebitTerm } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, vehicleRegistrations } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { findCurrentVehicle } from "./current-vehicle";
import type { RegoInput } from "./paperwork-input";

export type AddRegistrationResult =
  { status: "added"; isEarlierThanCurrent: boolean } | { status: "not_found" };

/** A direct debit that is still running: not stopped and not removed. */
const activeDirectDebit = and(
  isNull(vehicleRegistrations.expiresOn),
  isNull(vehicleRegistrations.directDebitStoppedOn),
  isNull(vehicleRegistrations.archivedAt),
);

/** Stops a direct debit and logs it, inside the caller's transaction. */
async function stopRegistration(
  tx: AnyTransaction,
  actor: ActingUser,
  registrationId: string,
  stoppedOn: string,
): Promise<boolean> {
  const [stopped] = await tx
    .update(vehicleRegistrations)
    .set({ directDebitStoppedOn: stoppedOn, updatedAt: new Date() })
    .where(
      and(
        eq(vehicleRegistrations.id, registrationId),
        eq(vehicleRegistrations.operatorId, actor.operatorId),
        activeDirectDebit,
      ),
    )
    .returning({ id: vehicleRegistrations.id });
  if (!stopped) {
    return false;
  }
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.vehicleRegistration,
    entityId: registrationId,
    action: ACTIVITY_ACTIONS.updated,
    valuesBefore: { directDebitStoppedOn: null },
    valuesAfter: { directDebitStoppedOn: stoppedOn },
  });
  return true;
}

/** A fixed-term renewal replaces a monthly direct debit, so any running one stops today. */
async function stopRunningDirectDebits(
  tx: AnyTransaction,
  actor: ActingUser,
  vehicleId: string,
  today: string,
): Promise<void> {
  const running = await tx
    .select({ id: vehicleRegistrations.id })
    .from(vehicleRegistrations)
    .where(and(eq(vehicleRegistrations.vehicleId, vehicleId), activeDirectDebit));
  for (const registration of running) {
    await stopRegistration(tx, actor, registration.id, today);
  }
}

/**
 * Records a rego renewal. One that expires before the car's current rego is
 * saved but flagged: it is probably an old one being entered late, or a typo.
 * `today` is the Operator's today, the day a replaced direct debit stops.
 */
export async function addRegistration(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
  input: RegoInput,
  today: string,
): Promise<AddRegistrationResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await findCurrentVehicle(tx, actor.operatorId, vehicleId))) {
      return { status: "not_found" };
    }
    const [current] = await tx
      .select({ expiresOn: vehicleRegistrations.expiresOn })
      .from(vehicleRegistrations)
      .where(
        and(
          eq(vehicleRegistrations.vehicleId, vehicleId),
          isNull(vehicleRegistrations.archivedAt),
          isNotNull(vehicleRegistrations.expiresOn),
        ),
      )
      .orderBy(desc(vehicleRegistrations.expiresOn))
      .limit(1);
    if (!isDirectDebitTerm(input.termMonths)) {
      await stopRunningDirectDebits(tx, actor, vehicleId, today);
    }
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
    const currentExpiry = current?.expiresOn ?? null;
    const isEarlierThanCurrent =
      input.expiresOn !== null && currentExpiry !== null && input.expiresOn < currentExpiry;
    return { status: "added", isEarlierThanCurrent };
  });
}

/** "Stop direct debit": the date it stopped, e.g. when the car was sold. */
export async function stopDirectDebit(
  database: AnyDatabase,
  actor: ActingUser,
  registrationId: string,
  stoppedOn: string,
): Promise<"stopped" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) =>
    (await stopRegistration(tx, actor, registrationId, stoppedOn)) ? "stopped" : "not_found",
  );
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
