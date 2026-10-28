import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  applySettingsChanges,
  InvalidSettingsError,
  readSettings,
  snapshotSettings,
} from "./settings";

/**
 * A stand-in for the sections later phases will add, so the rules can be
 * proved now: a nested section with defaults, as the real ones will be.
 */
const exampleSchema = z.object({
  reminders: z
    .object({
      daysBefore: z.array(z.number().int().positive()).default([30, 7]),
      isEnabled: z.boolean().default(true),
    })
    .prefault({}),
  bondHoldDays: z.number().int().min(0).default(28),
});

describe("Operator settings", () => {
  it("reads an empty document as every default", () => {
    expect(readSettings(exampleSchema, {})).toEqual({
      reminders: { daysBefore: [30, 7], isEnabled: true },
      bondHoldDays: 28,
    });
  });

  it("keeps what was changed and fills in the rest", () => {
    expect(readSettings(exampleSchema, { bondHoldDays: 14 })).toEqual({
      reminders: { daysBefore: [30, 7], isEnabled: true },
      bondHoldDays: 14,
    });
  });

  it("refuses a change that does not fit", () => {
    expect(() => applySettingsChanges(exampleSchema, {}, { bondHoldDays: -1 })).toThrow(
      InvalidSettingsError,
    );
  });

  it("refuses a stored document that no longer fits, rather than guessing", () => {
    expect(() => readSettings(exampleSchema, { bondHoldDays: "soon" })).toThrow(
      InvalidSettingsError,
    );
  });

  it("gives a rental a frozen copy the Operator's later changes cannot reach", () => {
    const settings = readSettings(exampleSchema, {});
    const snapshot = snapshotSettings(settings, 3);

    settings.reminders.daysBefore.push(1);

    expect(snapshot.version).toBe(3);
    expect(snapshot.settings.reminders.daysBefore).toEqual([30, 7]);
    expect(Object.isFrozen(snapshot.settings.reminders.daysBefore)).toBe(true);
  });
});
