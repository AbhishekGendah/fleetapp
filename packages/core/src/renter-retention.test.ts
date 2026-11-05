import { describe, expect, it } from "vitest";

import {
  isRenterDueForRetirement,
  renterRecordsKeptUntil,
  type RenterRetentionFacts,
} from "./renter-retention";

const ENDED = new Date("2019-03-01T00:00:00Z");
const SETTLED: RenterRetentionFacts = {
  addedAt: new Date("2018-01-10T00:00:00Z"),
  lastRentalEndedAt: ENDED,
  hasOpenRental: false,
  balanceCents: 0,
  bondHeldCents: 0,
  hasOpenDamageMatter: false,
};

describe("when a Renter's records are removed", () => {
  it("is seven years after their last rental ended", () => {
    expect(renterRecordsKeptUntil(SETTLED)).toEqual(new Date("2026-03-01T00:00:00Z"));
    expect(isRenterDueForRetirement(SETTLED, new Date("2026-02-28T23:59:59Z"))).toBe(false);
    expect(isRenterDueForRetirement(SETTLED, new Date("2026-03-01T00:00:00Z"))).toBe(true);
  });

  it("counts from when they were added if they never rented", () => {
    const neverRented = { ...SETTLED, lastRentalEndedAt: null };

    expect(renterRecordsKeptUntil(neverRented)).toEqual(new Date("2025-01-10T00:00:00Z"));
  });

  it("never while anything is still open: a rental, money either way, a bond, or damage", () => {
    const later = new Date("2030-01-01T00:00:00Z");
    for (const held of [
      { hasOpenRental: true },
      { balanceCents: 50_00 },
      { balanceCents: -10_00 },
      { bondHeldCents: 500_00 },
      { hasOpenDamageMatter: true },
    ]) {
      expect(isRenterDueForRetirement({ ...SETTLED, ...held }, later), JSON.stringify(held)).toBe(
        false,
      );
    }
  });
});
