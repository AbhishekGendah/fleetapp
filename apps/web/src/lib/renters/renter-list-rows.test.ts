import { describe, expect, it } from "vitest";

import type { RentalSummary } from "../rentals/rental-queries";
import { rentingOf } from "./renter-list-rows";

/** Fri 6 Nov 2026, 10:00 am in Perth. */
const CLOCK = { timeZone: "Australia/Perth", now: new Date("2026-11-06T02:00:00Z") };

function rental(changes: Partial<RentalSummary>): RentalSummary {
  return {
    id: "rental",
    status: "booked",
    type: "fixed_term",
    plannedStart: new Date("2026-11-07T01:00:00Z"),
    plannedEnd: new Date("2026-11-14T01:00:00Z"),
    renterId: "renter",
    renterFullName: "Riley Chen",
    renterPreferredName: null,
    vehicleId: "car",
    rego: "7PQR234",
    make: "Toyota",
    model: "Camry",
    weeklyRateCents: 350_00,
    dailyRateCents: 70_00,
    isLongTerm: true,
    handedOverAt: null,
    returnedAt: null,
    isOverdue: false,
    isStartingSoon: true,
    isAtRisk: false,
    ...changes,
  };
}

describe("what a Renter is renting, in the list's words", () => {
  it("puts the car out first, then a booking", () => {
    const out = rental({
      id: "out",
      status: "active",
      handedOverAt: new Date("2026-10-02T01:00:00Z"),
      plannedEnd: null,
    });
    const renting = rentingOf({ lastBackAt: null }, [rental({}), out], CLOCK);
    expect(renting.rental?.id).toBe("out");
    expect(renting.words).toBe("Since Fri 2 Oct, ongoing");
    expect(rentingOf({ lastBackAt: null }, [rental({})], CLOCK).words).toBe(
      "Starts Sat 7 Nov, 9:00 am",
    );
  });

  it("says when they last had a car back, or that they have had none", () => {
    expect(rentingOf({ lastBackAt: new Date("2026-09-29T05:00:00Z") }, [], CLOCK)).toMatchObject({
      rental: null,
      words: "Last back Tue 29 Sep",
    });
    expect(rentingOf({ lastBackAt: null }, [], CLOCK).words).toBe("No rentals yet");
  });
});
