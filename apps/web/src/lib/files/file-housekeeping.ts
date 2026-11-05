import {
  describeErrorForLog,
  MILLISECONDS_PER_DAY,
  REMOVED_TAX_PAPERS_KEPT_DAYS,
  TAX_PAPER_PURPOSES,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, files, inspections } from "@fleetapp/db/schema";
import type { AnyTransaction } from "@fleetapp/db/client";
import { qualified } from "@fleetapp/db/qualified";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, inArray, isNull, lt, not, or, sql } from "drizzle-orm";

import { findDueOperators, forEachOperator } from "../jobs/due-operators";
import { incomingKeyFor, type FileDependencies } from "./stored-files";

/** A deleted file can be recovered for this long, then it goes for good (rule 23). */
export const DELETED_FILE_KEPT_DAYS = 30;
/** An upload permission lasts 10 minutes; a day later, the upload is never coming. */
const UNFINISHED_UPLOAD_HOURS = 24;
const HOURS_PER_DAY = 24;

/** At most this many files per Operator per run, so one big backlog cannot run past the time limit; the next run carries on. */
const FILES_PER_RUN = 500;

type PurgeReason = "deleted_long_enough_ago" | "upload_never_finished";

interface Cutoffs {
  deletedBefore: Date;
  /** Removed receipts and tax papers are kept longer (batch 7 decision 4). */
  taxPapersDeletedBefore: Date;
  unfinishedBefore: Date;
}

export interface HousekeepingSummary {
  operators: number;
  purged: number;
  /** Files that failed this run: each logged and skipped, so the rest go on (review A7-10). */
  failedFiles: number;
  /** Operators skipped because something failed; the next run tries again. */
  failedOperators: number;
  /** Operators not reached before the run's time ran out; the next run carries on. */
  unreachedOperators: number;
}

function cutoffsFor(now: Date): Cutoffs {
  return {
    deletedBefore: new Date(now.getTime() - DELETED_FILE_KEPT_DAYS * MILLISECONDS_PER_DAY),
    taxPapersDeletedBefore: new Date(
      now.getTime() - REMOVED_TAX_PAPERS_KEPT_DAYS * MILLISECONDS_PER_DAY,
    ),
    unfinishedBefore: new Date(
      now.getTime() - (UNFINISHED_UPLOAD_HOURS / HOURS_PER_DAY) * MILLISECONDS_PER_DAY,
    ),
  };
}

/** Which Operators have work waiting: IDs only, through the one narrow database function. */
function operatorsWithWork(deps: FileDependencies, cutoffs: Cutoffs): Promise<string[]> {
  return findDueOperators(
    deps.database,
    sql`
      SELECT operator_id FROM app.operators_with_file_housekeeping_due(
        ${cutoffs.deletedBefore.toISOString()}::timestamptz,
        ${cutoffs.unfinishedBefore.toISOString()}::timestamptz
      ) AS operator_id
    `,
  );
}

/** One Operator's due files, read with that Operator's tenant context set (rule 3). */
async function findDueFiles(deps: FileDependencies, operatorId: string, cutoffs: Cutoffs) {
  return withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({
        id: files.id,
        storageArea: files.storageArea,
        objectKey: files.objectKey,
        deletedAt: files.deletedAt,
      })
      .from(files)
      .where(
        or(
          and(
            isNull(files.purgedAt),
            or(
              and(
                lt(files.deletedAt, cutoffs.deletedBefore),
                not(inArray(files.purpose, [...TAX_PAPER_PURPOSES])),
              ),
              lt(files.deletedAt, cutoffs.taxPapersDeletedBefore),
            ),
          ),
          and(
            isNull(files.confirmedAt),
            isNull(files.refusedAt),
            isNull(files.deletedAt),
            lt(files.createdAt, cutoffs.unfinishedBefore),
          ),
        ),
      )
      // Oldest first; a file that failed was touched then, so it waits behind the rest.
      .orderBy(asc(files.updatedAt))
      .limit(FILES_PER_RUN),
  );
}

/** Moves a file that failed behind the others, so it can never hold the rest up night after night. */
async function sendToBack(
  deps: FileDependencies,
  operatorId: string,
  fileId: string,
  now: Date,
): Promise<void> {
  await withTenant(deps.database, operatorId, (tx) =>
    tx.update(files).set({ updatedAt: now }).where(eq(files.id, fileId)),
  );
}

async function purgeFile(
  deps: FileDependencies,
  operatorId: string,
  file: Awaited<ReturnType<typeof findDueFiles>>[number],
  now: Date,
): Promise<void> {
  // Storage first: if the record were updated first and storage then failed,
  // the file would be left behind with nothing to say it still needs removing.
  await deps.storage.remove(file.storageArea, file.objectKey);
  // A file never confirmed is still where the browser sent it.
  await deps.storage.remove(file.storageArea, incomingKeyFor(file.objectKey));
  const reason: PurgeReason = file.deletedAt ? "deleted_long_enough_ago" : "upload_never_finished";
  await withTenant(deps.database, operatorId, async (tx) => {
    await tx
      .update(files)
      .set(file.deletedAt ? { purgedAt: now } : { refusedAt: now, purgedAt: now })
      .where(eq(files.id, file.id));
    await recordActivity(tx, {
      operatorId,
      actor: { type: "system", id: null },
      entityType: ACTIVITY_ENTITY_TYPES.file,
      entityId: file.id,
      action: ACTIVITY_ACTIONS.purged,
      valuesAfter: { reason },
    });
    await binOrphanedSmallCopies(tx, operatorId, file.id, now);
  });
}

/**
 * A photo whose upload never finished leaves its small copy showing nothing:
 * it is binned too, and goes for good with the usual 30 days (review A7-5).
 */
async function binOrphanedSmallCopies(
  tx: AnyTransaction,
  operatorId: string,
  photoId: string,
  now: Date,
): Promise<void> {
  const binned = await tx
    .update(files)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(files.operatorId, operatorId),
        eq(files.thumbnailOfFileId, photoId),
        isNull(files.deletedAt),
        // A finished checklist keeps its files as they are (migration 0045).
        or(
          isNull(files.inspectionId),
          sql`exists (select 1 from ${inspections} where ${qualified(inspections.id)} = ${qualified(files.inspectionId)} and ${qualified(inspections.status)} = 'in_progress')`,
        ),
      ),
    )
    .returning({ id: files.id });
  for (const thumbnail of binned) {
    await recordActivity(tx, {
      operatorId,
      actor: { type: "system", id: null },
      entityType: ACTIVITY_ENTITY_TYPES.file,
      entityId: thumbnail.id,
      action: ACTIVITY_ACTIONS.deleted,
      valuesAfter: { reason: "photo_never_arrived" },
    });
  }
}

/**
 * The daily clean-up: removes for good the files deleted over 30 days ago,
 * and uploads that never finished. Safe to run again at any time (rule 20):
 * a purged file is not found twice. One Operator's failure is logged and
 * skipped, so it cannot stop the others.
 */
export async function runFileHousekeeping(
  deps: FileDependencies,
  isOutOfTime: () => boolean = () => false,
): Promise<HousekeepingSummary> {
  const now = deps.now();
  const cutoffs = cutoffsFor(now);
  const operatorIds = await operatorsWithWork(deps, cutoffs);
  let failedFiles = 0;
  const run = await forEachOperator(
    operatorIds,
    "File clean-up",
    async (operatorId) => {
      const due = await findDueFiles(deps, operatorId, cutoffs);
      let purged = 0;
      for (const file of due) {
        if (isOutOfTime()) {
          break;
        }
        // Each file on its own: one that fails is logged (never its details) and the rest go on.
        try {
          await purgeFile(deps, operatorId, file, now);
          purged += 1;
        } catch (error) {
          failedFiles += 1;
          console.error("Removing a file for good failed", describeErrorForLog(error));
          await sendToBack(deps, operatorId, file.id, now);
        }
      }
      return purged;
    },
    isOutOfTime,
  );
  return {
    operators: run.operators,
    purged: run.done,
    failedFiles,
    failedOperators: run.failedOperators,
    unreachedOperators: run.unreachedOperators,
  };
}
