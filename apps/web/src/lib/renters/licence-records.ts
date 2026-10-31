import {
  changedValues,
  hasChanges,
  isUniqueViolation,
  withholdChangedFields,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, RENTER_LICENCE_UNIQUE_INDEX, renters } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { ActingUser } from "../acting-user";
import type { LicenceInput } from "./licence-input";
import { lockCurrentRenter, logRenterActivity } from "./renter-records";

/** Licence details are never written into the log, only which one changed (rule 7). */
const LICENCE_FIELDS = [
  "licenceIssuedIn",
  "licenceCountry",
  "licenceNumber",
  "licenceClass",
  "licenceType",
  "licenceExpiresOn",
] as const satisfies readonly (keyof LicenceInput)[];

/** Another of the Operator's Renters already has this licence, maybe archived. */
export interface LicenceOnFile {
  status: "on_file";
  renterId: string | null;
  isArchived: boolean;
}

export type SaveLicenceResult = "saved" | "unchanged" | "not_found" | LicenceOnFile;

/** Who holds the licence, after the database refused a second one. */
export async function findLicenceHolder(
  database: AnyDatabase,
  operatorId: string,
  licence: LicenceInput,
): Promise<LicenceOnFile> {
  const [holder] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: renters.id, archivedAt: renters.archivedAt })
      .from(renters)
      .where(
        and(
          eq(renters.operatorId, operatorId),
          eq(renters.licenceIssuedIn, licence.licenceIssuedIn),
          eq(sql`coalesce(${renters.licenceCountry}, '')`, licence.licenceCountry ?? ""),
          eq(renters.licenceNumber, licence.licenceNumber),
        ),
      ),
  );
  return {
    status: "on_file",
    renterId: holder?.id ?? null,
    isArchived: holder !== undefined && holder.archivedAt !== null,
  };
}

/**
 * Adds or changes a Renter's licence (one current licence each: a renewal is
 * an edit). A licence another Renter already has is refused, archived
 * Renters included, so a returning Renter is brought back, not entered twice.
 */
export async function saveLicence(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
  licence: LicenceInput,
): Promise<SaveLicenceResult> {
  try {
    return await withTenant(database, actor.operatorId, async (tx) => {
      const before = await lockCurrentRenter(tx, actor.operatorId, renterId);
      return before ? applyLicence(tx, actor, before, licence) : "not_found";
    });
  } catch (error) {
    if (isLicenceOnFileError(error)) {
      return findLicenceHolder(database, actor.operatorId, licence);
    }
    throw error;
  }
}

/** Whether the database refused a licence another Renter already has. */
export function isLicenceOnFileError(error: unknown): boolean {
  return isUniqueViolation(error, RENTER_LICENCE_UNIQUE_INDEX);
}

/**
 * Writes the licence onto the locked record `before`, logging which details
 * changed but never their values (rule 7). Throws the database's refusal if
 * another Renter has it: see isLicenceOnFileError.
 */
export async function applyLicence(
  tx: AnyTransaction,
  actor: ActingUser,
  before: typeof renters.$inferSelect,
  licence: LicenceInput,
): Promise<"saved" | "unchanged"> {
  const changes = changedValues(before, licence, LICENCE_FIELDS);
  if (!hasChanges(changes)) {
    return "unchanged";
  }
  await tx
    .update(renters)
    .set(licence)
    .where(
      and(
        eq(renters.id, before.id),
        eq(renters.operatorId, actor.operatorId),
        isNull(renters.archivedAt),
      ),
    );
  await logRenterActivity(
    tx,
    actor,
    before.id,
    ACTIVITY_ACTIONS.updated,
    withholdChangedFields(changes, LICENCE_FIELDS),
  );
  return "saved";
}
