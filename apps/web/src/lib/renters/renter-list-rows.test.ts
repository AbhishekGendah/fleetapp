import { describe, expect, it } from "vitest";

import type { RentalSummary } from "../rentals/rental-queries";
import { businessRentingOf, rentingOf } from "./renter-list-rows";

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
    renterKind: "person",
    renterFullName: "Riley Chen",
    renterPreferredName: null,
    renterTradingName: null,
    renterAbn: null,
    driverId: "renter",
    driverFullName: null,
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

describe("what a business is renting, in the list's words", () => {
  const out = (id: string) =>
    rental({
      id,
      status: "active",
      handedOverAt: new Date("2026-10-12T01:00:00Z"),
      plannedEnd: null,
    });

  it("counts its cars out, with its next booking after them", () => {
    expect(businessRentingOf({ lastBackAt: null }, [out("a"), out("b"), out("c")], CLOCK)).toEqual({
      rental: null,
      words: "3 cars out",
      shortWords: "3 cars out",
    });
    expect(
      businessRentingOf({ lastBackAt: null }, [rental({}), out("a"), out("b")], CLOCK).words,
    ).toMatch(/^2 cars out · 1 booked, /);
  });

  it("says one car as a person's would, with its rego", () => {
    const renting = businessRentingOf({ lastBackAt: null }, [out("a")], CLOCK);
    expect(renting.rental?.id).toBe("a");
    expect(renting.words).toBe("Since Mon 12 Oct, ongoing");
  });
});
