import { downloadName, LICENCE_SIDE_LABELS, type LicenceSide } from "@fleetapp/core";
import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, isNotNull } from "drizzle-orm";

import type { PlannedFile } from "../files/car-files";
import {
  licenceScanInUse,
  listLoggedFileIds,
  logFile,
  markScansDeleted,
  requestUpload,
  type FileActor,
  type FileDependencies,
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
export async function openLicenceScan(
  deps: FileDependencies,
  actor: FileActor,
  renterId: string,
  fileId: string,
): Promise<string | null> {
  const scan = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const [found] = await tx
      .select({
        storageArea: files.storageArea,
        objectKey: files.objectKey,
        contentType: files.contentType,
        side: files.licenceSide,
      })
      .from(files)
      .where(
        and(licenceScanInUse(actor.operatorId), eq(files.id, fileId), eq(files.renterId, renterId)),
      );
    if (found) {
      await logFile(tx, actor, fileId, "viewed", "renter_licence_scan");
    }
    return found;
  });
  if (!scan?.side) {
    return null;
  }
  return deps.storage.createViewUrl(
    scan.storageArea,
    scan.objectKey,
    downloadName(`Licence ${LICENCE_SIDE_LABELS[scan.side].toLowerCase()}`, scan.contentType),
  );
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
