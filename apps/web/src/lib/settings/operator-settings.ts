import {
  applySettingsChanges,
  changedValues,
  hasChanges,
  operatorSettingsSchema,
  readSettings,
  snapshotSettings,
  type OperatorSettings,
  type SettingsSnapshot,
  withholdFields,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, operatorSettings } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { eq, sql } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";

const SETTING_NAMES = Object.keys(operatorSettingsSchema.shape) as (keyof OperatorSettings)[];
/**
 * Settings the history says changed without showing them: "How to pay" holds
 * the business's bank details, which the history would otherwise keep for
 * good and AGS staff could read (review A8-8).
 */
const WITHHELD_SETTING_NAMES: readonly (keyof OperatorSettings)[] = ["howToPay"];

async function readStoredSettings(
  tx: AnyTransaction,
  operatorId: string,
  shouldLock: boolean,
): Promise<{ stored: Record<string, unknown>; version: number } | null> {
  const query = tx
    .select({ settings: operatorSettings.settings, version: operatorSettings.version })
    .from(operatorSettings)
    .where(eq(operatorSettings.operatorId, operatorId));
  const [row] = shouldLock ? await query.for("update") : await query;
  return row ? { stored: row.settings, version: row.version } : null;
}

/** The Operator's settings with every default filled in (rule 27). */
export async function loadOperatorSettings(
  database: AnyDatabase,
  operatorId: string,
): Promise<OperatorSettings> {
  const row = await withTenant(database, operatorId, (tx) =>
    readStoredSettings(tx, operatorId, false),
  );
  return readSettings(operatorSettingsSchema, row?.stored ?? {});
}

/** The version a rental records when the Operator has never changed a setting: all defaults. */
export const DEFAULT_SETTINGS_VERSION = 0;

/** A frozen copy of the Operator's settings now, for a new rental to keep (rule 14). */
export async function snapshotOperatorSettings(
  tx: AnyTransaction,
  operatorId: string,
): Promise<SettingsSnapshot<OperatorSettings>> {
  const row = await readStoredSettings(tx, operatorId, false);
  return snapshotSettings(
    readSettings(operatorSettingsSchema, row?.stored ?? {}),
    row?.version ?? DEFAULT_SETTINGS_VERSION,
  );
}

/**
 * Saves changed settings: checked as a whole, version bumped (so a rental
 * can record which settings it was made under, rule 14), and logged with
 * before and after (rule 19). Saving nothing new writes nothing.
 */
export async function saveOperatorSettings(
  database: AnyDatabase,
  actor: ActingUser,
  changes: Partial<OperatorSettings>,
): Promise<void> {
  await withTenant(database, actor.operatorId, async (tx) => {
    const row = await readStoredSettings(tx, actor.operatorId, true);
    const before = readSettings(operatorSettingsSchema, row?.stored ?? {});
    const { document, settings: after } = applySettingsChanges(
      operatorSettingsSchema,
      row?.stored ?? {},
      changes,
    );
    const changed = changedValues(before, after, SETTING_NAMES);
    if (!hasChanges(changed)) {
      return;
    }
    await tx
      .insert(operatorSettings)
      .values({ operatorId: actor.operatorId, settings: document })
      .onConflictDoUpdate({
        target: operatorSettings.operatorId,
        set: {
          settings: document,
          version: sql`${operatorSettings.version} + 1`,
          updatedAt: new Date(),
        },
      });
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.operatorSettings,
      entityId: actor.operatorId,
      action: ACTIVITY_ACTIONS.updated,
      valuesBefore: withholdFields(changed.valuesBefore, WITHHELD_SETTING_NAMES),
      valuesAfter: withholdFields(changed.valuesAfter, WITHHELD_SETTING_NAMES),
    });
  });
}
