import { describe, expect, it } from "vitest";

import type { RentalSummary } from "../rentals/rental-queries";
import { businessSinceFact, carsOutFact } from "./business-page-facts";

/** Sun 8 Nov 2026, 10:00 am in Perth. */
const CLOCK = { timeZone: "Australia/Perth", now: new Date("2026-11-08T02:00:00Z") };

function rental(changes: Partial<RentalSummary>): RentalSummary {
  return {
    id: "rental",
    status: "active",
    type: "ongoing",
    plannedStart: new Date("2026-10-12T01:00:00Z"),
    plannedEnd: null,
    renterId: "business",
    renterKind: "organisation",
    renterFullName: "Acme Rideshare Pty Ltd",
    renterPreferredName: null,
    renterTradingName: "Acme Rides",
    renterAbn: "51824753556",
    driverId: "driver",
    driverFullName: "Sam Lee",
    vehicleId: "car",
    rego: "1BRT482",
    make: "Toyota",
    model: "Camry",
    weeklyRateCents: 380_00,
    dailyRateCents: 76_00,
    isLongTerm: true,
    handedOverAt: new Date("2026-10-12T01:00:00Z"),
    returnedAt: null,
    isOverdue: false,
    isStartingSoon: false,
    isAtRisk: false,
    ...changes,
  };
}

describe("a business's strip facts", () => {
  it("counts its cars out, with its next booking under them", () => {
    const booked = rental({
      id: "booked",
      status: "booked",
      plannedStart: new Date("2026-11-09T01:00:00Z"),
      handedOverAt: null,
      driverId: null,
    });
    expect(carsOutFact([rental({ id: "a" }), rental({ id: "b" }), booked], CLOCK)).toEqual({
      label: "Cars out",
      value: "2",
      note: "1 booked, starts Mon 9 Nov, 9:00 am",
    });
    expect(carsOutFact([], CLOCK)).toEqual({ label: "Cars out", value: "0", note: "None booked" });
  });

  it("says since when, how many rentals and how many drivers", () => {
    expect(
      businessSinceFact(
        new Date("2026-09-07T02:00:00Z"),
        { rentals: 5, drivers: 1 },
        "Australia/Perth",
      ),
    ).toEqual({ label: "With you since", value: "Sep 2026", note: "5 rentals · 1 driver" });
  });
});
