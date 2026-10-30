import { z } from "zod";

import {
  DEFAULT_EXPIRY_WARNING_DAYS,
  MAXIMUM_EXPIRY_WARNING_DAYS,
  MINIMUM_EXPIRY_WARNING_DAYS,
} from "./expiry";

/**
 * Every Operator setting that is not a business detail, as one validated
 * document (docs/plans/phase-1b.md, slice 2).
 *
 * Each later phase adds its own section here, every field with a default
 * (rule 27). A stored document holds only what the Operator has changed;
 * anything missing is read as its default, so adding a setting needs no data
 * migration and every Operator gets the default at once.
 *
 * No setting is added before the feature that uses it.
 */
export const operatorSettingsSchema = z.object({
  /** Cars: how many days before rego or insurance expires it shows "Due soon". */
  vehicleExpiryWarningDays: z
    .number()
    .int()
    .min(MINIMUM_EXPIRY_WARNING_DAYS)
    .max(MAXIMUM_EXPIRY_WARNING_DAYS)
    .default(DEFAULT_EXPIRY_WARNING_DAYS),
  /** Renters: how many days before a licence expires it shows "Due soon". */
  licenceExpiryWarningDays: z
    .number()
    .int()
    .min(MINIMUM_EXPIRY_WARNING_DAYS)
    .max(MAXIMUM_EXPIRY_WARNING_DAYS)
    .default(DEFAULT_EXPIRY_WARNING_DAYS),
});

export type OperatorSettings = z.infer<typeof operatorSettingsSchema>;

/** A stored settings document of any shape, as it comes out of the database. */
export type StoredSettings = Record<string, unknown>;

export class InvalidSettingsError extends Error {
  constructor(readonly issues: z.core.$ZodIssue[]) {
    super("The settings were not valid.");
    this.name = "InvalidSettingsError";
  }
}

/**
 * The settings in force: what is stored, with defaults filled in. Throws if
 * what is stored no longer fits the schema, rather than quietly running a
 * rental on settings nobody chose.
 */
export function readSettings<Schema extends z.ZodType>(
  schema: Schema,
  stored: StoredSettings,
): z.infer<Schema> {
  const parsed = schema.safeParse(stored);
  if (!parsed.success) {
    throw new InvalidSettingsError(parsed.error.issues);
  }
  return parsed.data;
}

/**
 * The document to store after a change: the current settings with the
 * changes laid over them, checked against the schema as a whole.
 */
export function applySettingsChanges<Schema extends z.ZodType>(
  schema: Schema,
  current: StoredSettings,
  changes: StoredSettings,
): z.infer<Schema> {
  return readSettings(schema, { ...current, ...changes });
}

export interface SettingsSnapshot<Settings> {
  /** The settings version this copy was taken from. */
  version: number;
  settings: Readonly<Settings>;
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * A full, frozen copy of the settings, for a rental to keep (rule 14).
 * Taken as a copy so a later change to the Operator's settings can never
 * reach a rental already running on the old ones.
 */
export function snapshotSettings<Settings>(
  settings: Settings,
  version: number,
): SettingsSnapshot<Settings> {
  return deepFreeze({ version, settings: structuredClone(settings) });
}
