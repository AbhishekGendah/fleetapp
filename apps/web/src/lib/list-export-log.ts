import type { ExportFormat } from "@fleetapp/core/spreadsheet";
import type { AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";

import { recordUserChange, type ActingUser } from "./acting-user";

/**
 * Logs a list leaving the app as a download: which list, the format and how
 * many rows, never the rows. Lists holding Renters' names are logged, as
 * the download is personal information leaving the app.
 */
export async function recordListExport(
  tx: AnyTransaction,
  actor: ActingUser,
  download: { list: "renters" | "cars"; format: ExportFormat; rows: number },
): Promise<void> {
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.operator,
    entityId: actor.operatorId,
    action: ACTIVITY_ACTIONS.exported,
    valuesAfter: download,
  });
}
