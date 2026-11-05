import { describeErrorForLog, MILLISECONDS_PER_DAY } from "@fleetapp/core";
import { files, inspections, rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { findDueOperators, forEachOperator, type OperatorRun } from "../jobs/due-operators";
import type { FileDependencies } from "./stored-files";

/** Photos of a rental back this long ago move to cheaper storage (rule 23). */
const LONG_TERM_AFTER_DAYS = 365;
/** At most this many files per Operator per run; the next run carries on. */
const FILES_PER_RUN = 500;

const CHECKLIST_PHOTO_PURPOSES = ["vehicle_photo", "vehicle_photo_thumbnail"] as const;

export interface LongTermStorageSummary extends OperatorRun {
  /** Files that failed this run: each logged and skipped, so the rest go on. */
  failedFiles: number;
}

/** One Operator's checklist photos (and small copies) from rentals back over a year, still in standard storage. */
function findDueFiles(deps: FileDependencies, operatorId: string, returnedBefore: Date) {
  return withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({ id: files.id, storageArea: files.storageArea, objectKey: files.objectKey })
      .from(files)
      .innerJoin(
        inspections,
        and(eq(inspections.id, files.inspectionId), eq(inspections.operatorId, files.operatorId)),
      )
      .innerJoin(
        rentals,
        and(eq(rentals.id, inspections.rentalId), eq(rentals.operatorId, inspections.operatorId)),
      )
      .where(
        and(
          eq(files.operatorId, operatorId),
          inArray(files.purpose, [...CHECKLIST_PHOTO_PURPOSES]),
          isNotNull(files.confirmedAt),
          isNull(files.deletedAt),
          isNull(files.longTermStorageAt),
          lt(rentals.returnedAt, returnedBefore),
        ),
      )
      .orderBy(asc(files.createdAt))
      .limit(FILES_PER_RUN),
  );
}

/**
 * The nightly move of old checklist photos to S3 Glacier Instant Retrieval
 * (rule 23, review A7-4): the same address, opened as quickly, cheaper to
 * keep. Storage first, then the record, so a failure is simply tried again
 * the next night (rule 20).
 */
export async function moveOldPhotosToLongTermStorage(
  deps: FileDependencies,
  isOutOfTime: () => boolean = () => false,
): Promise<LongTermStorageSummary> {
  const now = deps.now();
  const returnedBefore = new Date(now.getTime() - LONG_TERM_AFTER_DAYS * MILLISECONDS_PER_DAY);
  const operatorIds = await findDueOperators(
    deps.database,
    sql`SELECT operator_id FROM app.operators_with_photos_for_long_term_storage(${returnedBefore.toISOString()}::timestamptz) AS operator_id`,
  );
  let failedFiles = 0;
  const run = await forEachOperator(
    operatorIds,
    "Moving old photos to long-term storage",
    async (operatorId) => {
      let moved = 0;
      for (const file of await findDueFiles(deps, operatorId, returnedBefore)) {
        if (isOutOfTime()) {
          break;
        }
        try {
          await deps.storage.moveToLongTermStorage(file.storageArea, file.objectKey);
          await withTenant(deps.database, operatorId, (tx) =>
            tx.update(files).set({ longTermStorageAt: now }).where(eq(files.id, file.id)),
          );
          moved += 1;
        } catch (error) {
          failedFiles += 1;
          console.error("Moving a photo to long-term storage failed", {
            fileId: file.id,
            ...describeErrorForLog(error),
          });
        }
      }
      return moved;
    },
    isOutOfTime,
  );
  return { ...run, failedFiles };
}
