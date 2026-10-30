import { describe, expect, it } from "vitest";

import { changedValues, hasChanges, WITHHELD_VALUE, withholdChangedFields } from "./changed-values";

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

describe("withholding personal details from history", () => {
  it("keeps which fields changed but not their values", () => {
    const changes = changedValues(
      { buyerName: "Jo", buyerPhone: "0412 345 678", priceCents: 100 },
      { buyerName: "Jo", buyerPhone: "0499 999 999", priceCents: 200 },
      ["buyerName", "buyerPhone", "priceCents"],
    );
    expect(withholdChangedFields(changes, ["buyerName", "buyerPhone"])).toEqual({
      valuesBefore: { buyerPhone: WITHHELD_VALUE, priceCents: 100 },
      valuesAfter: { buyerPhone: WITHHELD_VALUE, priceCents: 200 },
    });
  });
});
