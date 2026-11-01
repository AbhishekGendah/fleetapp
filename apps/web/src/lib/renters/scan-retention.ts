import {
  MILLISECONDS_PER_DAY,
  licenceScanDeleteAfter,
  MINIMUM_LICENCE_SCAN_KEPT_MONTHS,
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { inArray, sql } from "drizzle-orm";

import {
  binFilesAsSystem,
  licenceScanInUse,
  SYSTEM_BIN_REASONS,
  type FileDependencies,
} from "../files/stored-files";
import { findDueOperators, forEachOperator } from "../jobs/due-operators";
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

const SHORTEST_MONTH_DAYS = 28;

/** At most this many scans per Operator per run. */
const SCANS_PER_RUN = 500;

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
  // Required, never defaulted: a caller that forgot it would bin the scans
  // of Renters still on a rental.
  holds: RetentionHolds,
): Promise<ScanRetentionSummary> {
  const now = deps.now();
  // Counted in shortest months, so a scan due on the 31st is never missed.
  const earliestDue = new Date(
    now.getTime() - MINIMUM_LICENCE_SCAN_KEPT_MONTHS * SHORTEST_MONTH_DAYS * MILLISECONDS_PER_DAY,
  );
  const operatorIds = await findDueOperators(
    deps.database,
    sql`select operator_id from app.operators_with_licence_scans_added_before(${earliestDue.toISOString()}::timestamptz) as operator_id`,
  );
  const run = await forEachOperator(operatorIds, "Licence scan retention", async (operatorId) => {
    const { licenceScanKeptMonths } = await loadOperatorSettings(deps.database, operatorId);
    return withTenant(deps.database, operatorId, async (tx) => {
      // A limited batch per run, so a big backlog (a setting just lowered)
      // can never run past the time limit; the next night carries on.
      const scanIds = (await findScansDue(tx, operatorId, licenceScanKeptMonths, now, holds)).slice(
        0,
        SCANS_PER_RUN,
      );
      return scanIds.length === 0
        ? 0
        : binFilesAsSystem(
            tx,
            operatorId,
            now,
            "renter_licence_scan",
            inArray(files.id, scanIds),
            SYSTEM_BIN_REASONS.keptTheSetTime,
            { keptMonths: licenceScanKeptMonths },
          );
    });
  });
  const summary: ScanRetentionSummary = {
    operators: run.operators,
    binnedScans: run.done,
    failedOperators: run.failedOperators,
  };
  return summary;
}

/**
 * How many of the Operator's scans the nightly clean-up would bin with this
 * many months: shown before the setting is lowered, so nothing goes unawares.
 */
export async function countScansDueWith(
  database: FileDependencies["database"],
  operatorId: string,
  keptMonths: number,
  now: Date,
  holds: RetentionHolds,
): Promise<number> {
  return withTenant(
    database,
    operatorId,
    async (tx) => (await findScansDue(tx, operatorId, keptMonths, now, holds)).length,
  );
}
