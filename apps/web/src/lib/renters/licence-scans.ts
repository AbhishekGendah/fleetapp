import { LICENCE_SIDES, type LicenceSide } from "@fleetapp/core";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, activityLog, files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { PlannedFile } from "../files/car-files";
import {
  licenceScanInUse,
  listLoggedFileIds,
  markScansDeleted,
  openLicenceImage,
  requestUpload,
  type FileActor,
  type FileDependencies,
  SYSTEM_BIN_REASONS,
  type UploadRequestResult,
} from "../files/stored-files";
import { lockCurrentRenter } from "./renter-records";

export type LicenceScanUploadStart =
  Extract<UploadRequestResult, { status: "allowed" | "refused" }> | { status: "not_found" };

class RenterNotFoundError extends Error {
  constructor() {
    super("The Renter is not the Operator's, or is archived.");
    this.name = "RenterNotFoundError";
  }
}

/**
 * Starts sending one side of a Renter's licence. It goes in the identity
 * storage (rule 8), and once confirmed replaces that side's previous scan.
 */
export async function startLicenceScanUpload(
  deps: FileDependencies,
  actor: FileActor,
  renterId: string,
  side: LicenceSide,
  planned: PlannedFile,
): Promise<LicenceScanUploadStart> {
  return requestUpload(deps, actor, {
    purpose: "renter_licence_scan",
    ...planned,
    links: async (tx) => {
      if (!(await lockCurrentRenter(tx, actor.operatorId, renterId))) {
        // Undoes the transaction, so nothing is recorded.
        throw new RenterNotFoundError();
      }
      return { renterId, licenceSide: side };
    },
  }).catch((error: unknown) => {
    if (error instanceof RenterNotFoundError) {
      return { status: "not_found" as const };
    }
    throw error;
  });
}

export interface LicenceScan {
  id: string;
  contentType: string;
  addedAt: Date;
}

export type LicenceScans = Record<LicenceSide, LicenceScan | null>;

/** The scans in use for each side. Listing them is not looking at them, so nothing is logged. */
export async function listLicenceScans(
  database: FileDependencies["database"],
  operatorId: string,
  renterId: string,
): Promise<LicenceScans> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: files.id,
        contentType: files.contentType,
        addedAt: files.confirmedAt,
        side: files.licenceSide,
      })
      .from(files)
      .where(and(licenceScanInUse(operatorId), eq(files.renterId, renterId))),
  );
  const scanOf = (side: LicenceSide): LicenceScan | null => {
    const row = rows.find((each) => each.side === side);
    return row?.addedAt ? { id: row.id, contentType: row.contentType, addedAt: row.addedAt } : null;
  };
  return { front: scanOf("front"), back: scanOf("back") };
}

/**
 * A 5-minute link to one of the Renter's scans in use, or null. Every
 * opening is written to the log with who looked (rule 8).
 */
export function openLicenceScan(
  deps: FileDependencies,
  actor: FileActor,
  renterId: string,
  fileId: string,
): Promise<string | null> {
  return openLicenceImage(deps, actor, {
    fileId,
    purpose: "renter_licence_scan",
    which: and(licenceScanInUse(actor.operatorId), eq(files.renterId, renterId)),
    namePrefix: "Licence",
  });
}

/** Takes a scan off, e.g. one of the wrong card: hidden at once, kept 30 days, then gone. */
export async function removeLicenceScan(
  deps: FileDependencies,
  actor: FileActor,
  renterId: string,
  fileId: string,
): Promise<"removed" | "not_found"> {
  const removed = await withTenant(deps.database, actor.operatorId, (tx) =>
    markScansDeleted(
      tx,
      actor,
      deps.now(),
      and(eq(files.id, fileId), eq(files.renterId, renterId)),
    ),
  );
  return removed > 0 ? "removed" : "not_found";
}

/** Every scan the Renter has had, removed ones too, so the Log shows each upload, view and removal. */
export function listRenterFileIds(
  database: FileDependencies["database"],
  operatorId: string,
  renterId: string,
): Promise<string[]> {
  return listLoggedFileIds(database, operatorId, eq(files.renterId, renterId), [
    "renter_licence_scan",
  ]);
}

export interface LicenceScanRecord {
  side: LicenceSide;
  addedAt: Date;
  removedAt: Date | null;
}

/** Every scan the Renter has had, removed ones too, oldest first: for the "everything we hold" download. */
export async function listAllLicenceScans(
  database: FileDependencies["database"],
  operatorId: string,
  renterId: string,
): Promise<LicenceScanRecord[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ side: files.licenceSide, addedAt: files.confirmedAt, removedAt: files.deletedAt })
      .from(files)
      .where(
        and(
          eq(files.operatorId, operatorId),
          eq(files.renterId, renterId),
          isNotNull(files.confirmedAt),
        ),
      )
      .orderBy(asc(files.confirmedAt)),
  );
  return rows.flatMap((row) =>
    row.side && row.addedAt
      ? [{ side: row.side, addedAt: row.addedAt, removedAt: row.removedAt }]
      : [],
  );
}

/**
 * The sides whose latest scan was binned by the nightly retention timer, not
 * by a person, with the number of months the setting was then (null if not
 * recorded): the Licence tab says so, so the Operator knows to ask for new
 * photos rather than wonder where they went.
 */
export async function listSidesDeletedByTimer(
  database: FileDependencies["database"],
  operatorId: string,
  renterId: string,
): Promise<ReadonlyMap<LicenceSide, number | null>> {
  return withTenant(database, operatorId, async (tx) => {
    const deleted = await tx
      .select({ id: files.id, side: files.licenceSide })
      .from(files)
      .where(
        and(
          eq(files.operatorId, operatorId),
          eq(files.renterId, renterId),
          eq(files.purpose, "renter_licence_scan"),
          isNotNull(files.deletedAt),
        ),
      )
      .orderBy(desc(files.deletedAt));
    const latestPerSide = LICENCE_SIDES.flatMap((side) => {
      const latest = deleted.find((scan) => scan.side === side);
      return latest ? [{ side, id: latest.id }] : [];
    });
    if (latestPerSide.length === 0) {
      return new Map<LicenceSide, number | null>();
    }
    const byTimer = await tx
      .select({ id: activityLog.entityId, values: activityLog.valuesAfter })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.operatorId, operatorId),
          eq(activityLog.entityType, ACTIVITY_ENTITY_TYPES.file),
          inArray(
            activityLog.entityId,
            latestPerSide.map((scan) => scan.id),
          ),
          eq(activityLog.action, ACTIVITY_ACTIONS.deleted),
          eq(activityLog.actorType, "system"),
          sql`${activityLog.valuesAfter} ->> 'reason' = ${SYSTEM_BIN_REASONS.keptTheSetTime}`,
        ),
      );
    return new Map(
      latestPerSide.flatMap((scan) => {
        const line = byTimer.find((each) => each.id === scan.id);
        return line ? [[scan.side, keptMonthsOf(line.values)] as const] : [];
      }),
    );
  });
}

/** The months recorded with a timer deletion, or null for one logged before they were. */
function keptMonthsOf(values: unknown): number | null {
  const months: unknown =
    typeof values === "object" && values !== null ? Reflect.get(values, "keptMonths") : null;
  return typeof months === "number" ? months : null;
}
