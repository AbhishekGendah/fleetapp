import {
  MILLISECONDS_PER_DAY,
  REMOVED_TAX_PAPERS_KEPT_DAYS,
  TAX_PAPER_PURPOSES,
  type FilePurpose,
} from "@fleetapp/core";
import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm";

import { isOfCurrentCar } from "../vehicles/current-vehicle";
import { DELETED_FILE_KEPT_DAYS } from "./file-housekeeping";
import { logFile, type FileActor, type FileDependencies } from "./stored-files";

/** A car's own photos and documents, which come back within 30 days of removal. */
const CAR_FILE_PURPOSES = [
  "vehicle_photo",
  "vehicle_document",
] as const satisfies readonly FilePurpose[];

export type RemovedFileKind = "photo" | "document" | "paper";

export interface RemovedFile {
  id: string;
  kind: RemovedFileKind;
  label: string;
  removedAt: Date;
}

function kindOf(purpose: FilePurpose): RemovedFileKind {
  if (purpose === "vehicle_photo") {
    return "photo";
  }
  return purpose === "vehicle_document" ? "document" : "paper";
}

/**
 * Removed files of this car that can still come back: its photos and
 * documents for 30 days, the papers on its records (receipts, tax invoices)
 * for 5 years (review A7-4, G8-7). Never a checklist's photos: those stay
 * with their checklist.
 */
function stillRecoverable(operatorId: string, vehicleId: string, now: Date): SQL {
  const since = (days: number) => new Date(now.getTime() - days * MILLISECONDS_PER_DAY);
  return and(
    eq(files.operatorId, operatorId),
    eq(files.vehicleId, vehicleId),
    isNotNull(files.confirmedAt),
    isNotNull(files.deletedAt),
    isNull(files.purgedAt),
    isNull(files.inspectionId),
    or(
      and(
        inArray(files.purpose, [...CAR_FILE_PURPOSES]),
        gte(files.deletedAt, since(DELETED_FILE_KEPT_DAYS)),
      ),
      and(
        inArray(files.purpose, [...TAX_PAPER_PURPOSES]),
        gte(files.deletedAt, since(REMOVED_TAX_PAPERS_KEPT_DAYS)),
      ),
    ),
  )!;
}

/** What can be brought back for this car, the latest removed first. */
export async function listRemovedCarFiles(
  database: FileDependencies["database"],
  operatorId: string,
  vehicleId: string,
  now: Date,
): Promise<RemovedFile[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: files.id,
        purpose: files.purpose,
        label: files.label,
        deletedAt: files.deletedAt,
      })
      .from(files)
      .where(stillRecoverable(operatorId, vehicleId, now))
      .orderBy(desc(files.deletedAt)),
  );
  return rows.map((row) => ({
    id: row.id,
    kind: kindOf(row.purpose),
    label: row.label ?? "",
    removedAt: row.deletedAt!,
  }));
}

/**
 * Brings back a file removed by mistake, a photo with its small copy, while
 * it can still come back and its car is current. Logged as restored.
 */
export async function restoreCarFile(
  deps: FileDependencies,
  actor: FileActor,
  vehicleId: string,
  fileId: string,
): Promise<"restored" | "not_found"> {
  return withTenant(deps.database, actor.operatorId, async (tx) => {
    const [restored] = await tx
      .update(files)
      .set({ deletedAt: null })
      .where(
        and(
          eq(files.id, fileId),
          stillRecoverable(actor.operatorId, vehicleId, deps.now()),
          isOfCurrentCar(files.vehicleId),
        ),
      )
      .returning({ id: files.id, purpose: files.purpose });
    if (!restored) {
      return "not_found";
    }
    const thumbnails = await tx
      .update(files)
      .set({ deletedAt: null })
      .where(
        and(
          eq(files.operatorId, actor.operatorId),
          eq(files.thumbnailOfFileId, fileId),
          isNotNull(files.deletedAt),
          isNull(files.purgedAt),
        ),
      )
      .returning({ id: files.id, purpose: files.purpose });
    for (const file of [restored, ...thumbnails]) {
      await logFile(tx, actor, file.id, "restored", file.purpose);
    }
    return "restored";
  });
}
