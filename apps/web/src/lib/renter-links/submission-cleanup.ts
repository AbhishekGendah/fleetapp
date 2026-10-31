import { describeErrorForLog, MILLISECONDS_PER_DAY } from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  files,
  renterLinks,
  renterSubmissions,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import type { FileDependencies } from "../files/stored-files";

/** What a Renter sent and was never approved is kept this long after their link ended. */
export const UNAPPROVED_SUBMISSION_KEPT_DAYS = 30;

const SYSTEM_ACTOR = { type: "system", id: null } as const;

const dueOperatorsSchema = z.object({ rows: z.array(z.object({ operator_id: z.uuid() })) });
const removedSchema = z.object({
  rows: z.array(z.object({ submission_id: z.uuid(), renter_id: z.uuid() })),
});

export interface SubmissionCleanupSummary {
  operators: number;
  removedSubmissions: number;
  removedPhotos: number;
  /** Operators skipped because something failed; the next run tries again. */
  failedOperators: number;
}

/** A link has ended when it expired or was cancelled, whichever came first. */
const linkEndedBefore = (cutoff: Date) =>
  sql`least(${renterLinks.expiresAt}, ${renterLinks.cancelledAt}) < ${cutoff.toISOString()}::timestamptz`;

/** Bins every photo still held for the Operator's ended links (kept 30 more days, rule 23). */
async function binEndedLinkPhotos(
  tx: AnyTransaction,
  operatorId: string,
  cutoff: Date,
  now: Date,
): Promise<number> {
  const endedLinks = tx
    .select({ id: renterLinks.id })
    .from(renterLinks)
    .where(and(eq(renterLinks.operatorId, operatorId), linkEndedBefore(cutoff)));
  const binned = await tx
    .update(files)
    .set({ deletedAt: now })
    .where(
      and(
        eq(files.operatorId, operatorId),
        eq(files.purpose, "renter_submitted_scan"),
        isNull(files.deletedAt),
        inArray(files.renterLinkId, endedLinks),
      ),
    )
    .returning({ id: files.id });
  for (const photo of binned) {
    await recordActivity(tx, {
      operatorId,
      actor: SYSTEM_ACTOR,
      entityType: ACTIVITY_ENTITY_TYPES.file,
      entityId: photo.id,
      action: ACTIVITY_ACTIONS.deleted,
      valuesAfter: { purpose: "renter_submitted_scan" },
    });
  }
  return binned.length;
}

/** One Operator's clean-up, with that Operator's tenant context set (rule 3). */
async function cleanUpOperator(
  deps: FileDependencies,
  operatorId: string,
  cutoff: Date,
  now: Date,
): Promise<{ submissions: number; photos: number }> {
  return withTenant(deps.database, operatorId, async (tx) => {
    const photos = await binEndedLinkPhotos(tx, operatorId, cutoff, now);
    // Unhooked from their photos first: the database removes a submission
    // only once no file points at it.
    const unapproved = tx
      .select({ id: renterSubmissions.id })
      .from(renterSubmissions)
      .where(
        and(eq(renterSubmissions.operatorId, operatorId), ne(renterSubmissions.status, "approved")),
      );
    await tx
      .update(files)
      .set({ submissionId: null })
      .where(
        and(
          eq(files.operatorId, operatorId),
          isNull(files.renterId),
          inArray(files.submissionId, unapproved),
          sql`${files.deletedAt} is not null`,
        ),
      );
    const removed = removedSchema.parse(
      await tx.execute(
        sql`select submission_id, renter_id from app.delete_abandoned_renter_submissions(${cutoff.toISOString()}::timestamptz)`,
      ),
    ).rows;
    for (const submission of removed) {
      await recordActivity(tx, {
        operatorId,
        actor: SYSTEM_ACTOR,
        entityType: ACTIVITY_ENTITY_TYPES.renter,
        entityId: submission.renter_id,
        action: ACTIVITY_ACTIONS.submissionRemoved,
      });
    }
    return { submissions: removed.length, photos };
  });
}

/**
 * Part of the daily clean-up: what a Renter sent and was never approved is
 * removed 30 days after their link ended, with its photos (binned, then gone
 * 30 days later like any deleted file). Safe to run again (rule 20). One
 * Operator's failure is logged and skipped.
 */
export async function removeUnapprovedSubmissions(
  deps: FileDependencies,
): Promise<SubmissionCleanupSummary> {
  const now = deps.now();
  const cutoff = new Date(now.getTime() - UNAPPROVED_SUBMISSION_KEPT_DAYS * MILLISECONDS_PER_DAY);
  const due = dueOperatorsSchema.parse(
    await deps.database.execute(
      sql`select operator_id from app.operators_with_abandoned_renter_submissions(${cutoff.toISOString()}::timestamptz) as operator_id`,
    ),
  ).rows;
  const summary: SubmissionCleanupSummary = {
    operators: due.length,
    removedSubmissions: 0,
    removedPhotos: 0,
    failedOperators: 0,
  };
  for (const { operator_id: operatorId } of due) {
    try {
      const cleaned = await cleanUpOperator(deps, operatorId, cutoff, now);
      summary.removedSubmissions += cleaned.submissions;
      summary.removedPhotos += cleaned.photos;
    } catch (error) {
      summary.failedOperators += 1;
      console.error("Submission clean-up failed for an Operator", {
        operatorId,
        ...describeErrorForLog(error),
      });
    }
  }
  return summary;
}
