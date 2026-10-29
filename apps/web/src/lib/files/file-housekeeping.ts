import { describeErrorForLog, MILLISECONDS_PER_DAY } from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { FileDependencies } from "./stored-files";

/** A deleted file can be recovered for this long, then it goes for good (rule 23). */
export const DELETED_FILE_KEPT_DAYS = 30;
/** An upload permission lasts 10 minutes; a day later, the upload is never coming. */
const UNFINISHED_UPLOAD_HOURS = 24;
const HOURS_PER_DAY = 24;

/** What the database driver hands back for the function's rows. */
const dueOperatorsSchema = z.object({ rows: z.array(z.object({ operator_id: z.uuid() })) });

type PurgeReason = "deleted_over_30_days" | "upload_never_finished";

interface Cutoffs {
  deletedBefore: Date;
  unfinishedBefore: Date;
}

export interface HousekeepingSummary {
  operators: number;
  purged: number;
  /** Operators skipped because something failed; the next run tries again. */
  failedOperators: number;
}

function cutoffsFor(now: Date): Cutoffs {
  return {
    deletedBefore: new Date(now.getTime() - DELETED_FILE_KEPT_DAYS * MILLISECONDS_PER_DAY),
    unfinishedBefore: new Date(
      now.getTime() - (UNFINISHED_UPLOAD_HOURS / HOURS_PER_DAY) * MILLISECONDS_PER_DAY,
    ),
  };
}

/** Which Operators have work waiting: IDs only, through the one narrow database function. */
async function operatorsWithWork(deps: FileDependencies, cutoffs: Cutoffs): Promise<string[]> {
  const result: unknown = await deps.database.execute(sql`
    SELECT operator_id FROM app.operators_with_file_housekeeping_due(
      ${cutoffs.deletedBefore.toISOString()}::timestamptz,
      ${cutoffs.unfinishedBefore.toISOString()}::timestamptz
    ) AS operator_id
  `);
  return dueOperatorsSchema.parse(result).rows.map((row) => row.operator_id);
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
          and(lt(files.deletedAt, cutoffs.deletedBefore), isNull(files.purgedAt)),
          and(
            isNull(files.confirmedAt),
            isNull(files.refusedAt),
            isNull(files.deletedAt),
            lt(files.createdAt, cutoffs.unfinishedBefore),
          ),
        ),
      ),
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
  const reason: PurgeReason = file.deletedAt ? "deleted_over_30_days" : "upload_never_finished";
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
  });
}

/**
 * The daily clean-up: removes for good the files deleted over 30 days ago,
 * and uploads that never finished. Safe to run again at any time (rule 20):
 * a purged file is not found twice. One Operator's failure is logged and
 * skipped, so it cannot stop the others.
 */
export async function runFileHousekeeping(deps: FileDependencies): Promise<HousekeepingSummary> {
  const now = deps.now();
  const cutoffs = cutoffsFor(now);
  const operatorIds = await operatorsWithWork(deps, cutoffs);
  const summary: HousekeepingSummary = {
    operators: operatorIds.length,
    purged: 0,
    failedOperators: 0,
  };

  for (const operatorId of operatorIds) {
    try {
      for (const file of await findDueFiles(deps, operatorId, cutoffs)) {
        await purgeFile(deps, operatorId, file, now);
        summary.purged += 1;
      }
    } catch (error) {
      summary.failedOperators += 1;
      console.error("File clean-up failed for an Operator", {
        operatorId,
        ...describeErrorForLog(error),
      });
    }
  }
  return summary;
}
