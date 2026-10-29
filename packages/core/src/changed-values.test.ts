import { describe, expect, it } from "vitest";

import { changedValues, hasChanges } from "./changed-values";

describe("changedValues", () => {
  it("keeps only the fields that differ", () => {
    const changes = changedValues(
      { name: "A", year: 2020, colour: "Red" },
      { name: "A", year: 2021, colour: "Red" },
      ["name", "year", "colour"],
    );
    expect(changes).toEqual({ valuesBefore: { year: 2020 }, valuesAfter: { year: 2021 } });
    expect(hasChanges(changes)).toBe(true);
  });

  it("treats equal dates as unchanged", () => {
    const changes = changedValues(
      { at: new Date("2026-01-01T00:00:00Z") },
      { at: new Date("2026-01-01T00:00:00Z") },
      ["at"],
    );
    expect(hasChanges(changes)).toBe(false);
  });
});
