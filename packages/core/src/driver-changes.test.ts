import { describe, expect, it } from "vitest";

import { canChangeDriver, driverChangeStepNames } from "./driver-changes";

describe("driver changes", () => {
  it("are only for a business's car that is out", () => {
    expect(canChangeDriver("active", "organisation")).toBe(true);
    expect(canChangeDriver("active", "person")).toBe(false);
    for (const status of ["draft", "booked", "returned", "closed", "cancelled"] as const) {
      expect(canChangeDriver(status, "organisation")).toBe(false);
    }
  });

  it("name each step by who is in it", () => {
    expect(driverChangeStepNames("Sam", "Mia")).toEqual([
      "Why and who",
      "Check in from Sam",
      "Mia signs",
    ]);
  });
});
