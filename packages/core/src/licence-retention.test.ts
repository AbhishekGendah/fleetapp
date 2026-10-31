import { describe, expect, it } from "vitest";

import { addMonthsToMoment, licenceScanDeleteAfter } from "./licence-retention";

describe("adding months", () => {
  it("keeps the day and time, and stops at a short month's end", () => {
    expect(addMonthsToMoment(new Date("2026-03-15T02:30:00Z"), 12).toISOString()).toBe(
      "2027-03-15T02:30:00.000Z",
    );
    expect(addMonthsToMoment(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(addMonthsToMoment(new Date("2027-12-31T00:00:00Z"), 2).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });
});

describe("when a licence scan goes", () => {
  const addedAt = new Date("2026-01-10T00:00:00Z");

  it("counts from when it was added if the Renter has not rented", () => {
    expect(licenceScanDeleteAfter({ addedAt, lastRentalEndedAt: null }, 12).toISOString()).toBe(
      "2027-01-10T00:00:00.000Z",
    );
  });

  it("counts from the last rental's end when that is later", () => {
    const lastRentalEndedAt = new Date("2026-06-01T00:00:00Z");
    expect(licenceScanDeleteAfter({ addedAt, lastRentalEndedAt }, 12).toISOString()).toBe(
      "2027-06-01T00:00:00.000Z",
    );
  });

  it("ignores a rental that ended before the scan was added", () => {
    const lastRentalEndedAt = new Date("2025-06-01T00:00:00Z");
    expect(licenceScanDeleteAfter({ addedAt, lastRentalEndedAt }, 6).toISOString()).toBe(
      "2026-07-10T00:00:00.000Z",
    );
  });
});
