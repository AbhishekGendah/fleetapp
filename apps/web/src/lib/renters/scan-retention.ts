import {
  addMonthsToMoment,
  describeErrorForLog,
  licenceScanDeleteAfter,
  MINIMUM_LICENCE_SCAN_KEPT_MONTHS,
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { binFilesAsSystem, licenceScanInUse, type FileDependencies } from "../files/stored-files";
import { loadOperatorSettings } from "../settings/operator-settings";

/**
 * What keeps a Renter's scans past the timer, from the parts of the app that
 * know: when their last rental ended (rentals, Phase 3), and whether a rental,
 * fine or dispute is still open (Phases 3 and 4).
 */
export interface RetentionHolds {
  lastRentalEnds: (tx: AnyTransaction, renterIds: readonly string[]) => Promise<Map<string, Date>>;
  rentersWithOpenMatters: (
    tx: AnyTransaction,
    renterIds: readonly string[],
  ) => Promise<ReadonlySet<string>>;
}

/**
 * Until rentals, fines and disputes exist, nothing holds a scan back.
 * TODO(Phase 3): plug in rentals' last end and open rentals; fines and
 * disputes add theirs when built.
 */
export const NO_HOLDS_YET: RetentionHolds = {
  lastRentalEnds: async () => new Map(),
  rentersWithOpenMatters: async () => new Set(),
};

const dueOperatorsSchema = z.object({ rows: z.array(z.object({ operator_id: z.uuid() })) });

export interface ScanRetentionSummary {
  operators: number;
  binnedScans: number;
  /** Operators skipped because something failed; the next run tries again. */
  failedOperators: number;
}

/** The scans of one Operator whose time is up, given the Operator's setting. */
async function findScansDue(
  tx: AnyTransaction,
  operatorId: string,
  keptMonths: number,
  now: Date,
  holds: RetentionHolds,
): Promise<string[]> {
  const scans = await tx
    .select({ id: files.id, renterId: files.renterId, addedAt: files.confirmedAt })
    .from(files)
    .where(licenceScanInUse(operatorId));
  const renterIds = [...new Set(scans.flatMap((scan) => (scan.renterId ? [scan.renterId] : [])))];
  const lastRentalEnds = await holds.lastRentalEnds(tx, renterIds);
  const held = await holds.rentersWithOpenMatters(tx, renterIds);
  return scans.flatMap((scan) => {
    if (!scan.renterId || !scan.addedAt || held.has(scan.renterId)) {
      return [];
    }
    const facts = {
      addedAt: scan.addedAt,
      lastRentalEndedAt: lastRentalEnds.get(scan.renterId) ?? null,
    };
    return licenceScanDeleteAfter(facts, keptMonths) <= now ? [scan.id] : [];
  });
}

/**
 * Part of the daily clean-up: licence scans go to the bin once kept the
 * Operator's set number of months after the later of being added and the
 * Renter's last rental, unless something holds them (APP 11.2). Gone for
 * good 30 days later like any deleted file. Safe to run again (rule 20).
 */
export async function binExpiredLicenceScans(
  deps: FileDependencies,
  holds: RetentionHolds = NO_HOLDS_YET,
): Promise<ScanRetentionSummary> {
  const now = deps.now();
  const earliestDue = addMonthsToMoment(now, -MINIMUM_LICENCE_SCAN_KEPT_MONTHS);
  const due = dueOperatorsSchema.parse(
    await deps.database.execute(
      sql`select operator_id from app.operators_with_licence_scans_added_before(${earliestDue.toISOString()}::timestamptz) as operator_id`,
    ),
  ).rows;
  const summary: ScanRetentionSummary = {
    operators: due.length,
    binnedScans: 0,
    failedOperators: 0,
  };
  for (const { operator_id: operatorId } of due) {
    try {
      const { licenceScanKeptMonths } = await loadOperatorSettings(deps.database, operatorId);
      summary.binnedScans += await withTenant(deps.database, operatorId, async (tx) => {
        const scanIds = await findScansDue(tx, operatorId, licenceScanKeptMonths, now, holds);
        return scanIds.length === 0
          ? 0
          : binFilesAsSystem(
              tx,
              operatorId,
              now,
              "renter_licence_scan",
              inArray(files.id, scanIds),
              "kept_the_set_time",
            );
      });
    } catch (error) {
      summary.failedOperators += 1;
      console.error("Licence scan retention failed for an Operator", {
        operatorId,
        ...describeErrorForLog(error),
      });
    }
  }
  return summary;
}
