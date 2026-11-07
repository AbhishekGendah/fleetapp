import { describe, expect, it } from "vitest";

import { carPaperworkAlert } from "./car-list-rows";
import {
  carNowOf,
  carNowShortText,
  carNowText,
  type CarNowInput,
  type CarNowRental,
} from "./car-now";

/** Fri 6 Nov 2026, 10:00 am in Perth. */
const CLOCK = { timeZone: "Australia/Perth", now: new Date("2026-11-06T02:00:00Z") };
const TODAY = "2026-11-06";

function rental(changes: Partial<CarNowRental> = {}): CarNowRental {
  return {
    id: "rental-1",
    renterId: "renter-1",
    renterName: "Jamie Park",
    plannedStart: new Date("2026-10-30T01:00:00Z"),
    plannedEnd: null,
    handedOverAt: new Date("2026-10-30T01:10:00Z"),
    ...changes,
  };
}

function car(changes: Partial<CarNowInput> = {}): CarNowInput {
  return {
    status: "available",
    isArchived: false,
    statusReason: null,
    statusExpectedBack: null,
    idleSince: new Date("2026-11-02T03:00:00Z"),
    withRenter: null,
    nextBooking: null,
    ...changes,
  };
}

describe("what a car is doing now", () => {
  it("names who has it and since when", () => {
    const now = carNowOf(car({ status: "rented", withRenter: rental() }), CLOCK);
    expect(carNowText(now)).toBe("Jamie Park, since Fri 30 Oct");
    expect(carNowShortText(now)).toBe("With Jamie Park, since Fri 30 Oct");
  });

  it("says a car due back today with the time, and one past its end as due back", () => {
    const backToday = rental({ plannedEnd: new Date("2026-11-06T07:30:00Z") });
    expect(carNowText(carNowOf(car({ withRenter: backToday }), CLOCK))).toBe(
      "Jamie Park, back today 3:30 pm",
    );
    const late = rental({ plannedEnd: new Date("2026-11-03T07:30:00Z") });
    expect(carNowText(carNowOf(car({ withRenter: late }), CLOCK))).toBe(
      "Jamie Park, was due back Tue 3 Nov",
    );
  });

  it("says why a car is in the workshop and when it is back, or that it is late", () => {
    const workshop = car({
      status: "in_service",
      statusReason: "Panel repair",
      statusExpectedBack: "2026-11-09",
    });
    expect(carNowText(carNowOf(workshop, CLOCK))).toBe("Panel repair, back Mon 9 Nov");
    expect(carNowText(carNowOf({ ...workshop, statusExpectedBack: "2026-11-05" }, CLOCK))).toBe(
      "Panel repair, was due back Thu 5 Nov",
    );
    expect(carNowText(carNowOf(car({ status: "off_road" }), CLOCK))).toBe("In the workshop");
  });

  it("says how long an available car has sat, one day or many", () => {
    expect(carNowText(carNowOf(car(), CLOCK))).toBe("Idle 4 days");
    expect(carNowText(carNowOf(car({ idleSince: new Date("2026-11-05T03:00:00Z") }), CLOCK))).toBe(
      "Idle 1 day",
    );
  });

  it("puts a booking today or tomorrow first, and a later one after the idle days", () => {
    const tomorrow = rental({
      renterName: "Riley Chen",
      plannedStart: new Date("2026-11-07T01:00:00Z"),
      handedOverAt: null,
    });
    expect(carNowText(carNowOf(car({ nextBooking: tomorrow }), CLOCK))).toBe(
      "Booked by Riley Chen, Sat 7 Nov",
    );
    const later = {
      ...tomorrow,
      renterName: "Taylor Smith",
      plannedStart: new Date("2026-11-17T01:00:00Z"),
    };
    const now = carNowOf(car({ nextBooking: later }), CLOCK);
    expect(carNowText(now)).toBe("Idle 4 days · booked by Taylor Smith, Tue 17 Nov");
    expect(carNowShortText(now)).toBe("Idle 4 days · booked Tue 17 Nov");
  });

  it("says nothing for an archived, sold or written-off car", () => {
    expect(carNowOf(car({ isArchived: true }), CLOCK)).toBeNull();
    expect(carNowOf(car({ status: "sold" }), CLOCK)).toBeNull();
    expect(carNowText(null)).toBeNull();
  });
});

describe("a car's paperwork line on a phone", () => {
  const fine = {
    isRegoOnDirectDebit: false,
    regoExpiresOn: "2027-03-14",
    regoStatus: "current",
    insuranceEndsOn: "2027-06-30",
    insuranceStatus: "current",
  } as const;

  it("says nothing while the rego and insurance are fine, or the rego is on direct debit", () => {
    expect(carPaperworkAlert(fine, TODAY)).toBeNull();
    expect(
      carPaperworkAlert({ ...fine, isRegoOnDirectDebit: true, regoExpiresOn: null }, TODAY),
    ).toBeNull();
  });

  it("names the rego first, then the insurance", () => {
    expect(
      carPaperworkAlert({ ...fine, regoExpiresOn: "2026-11-12", regoStatus: "due_soon" }, TODAY),
    ).toBe("Rego due Thu 12 Nov");
    expect(carPaperworkAlert({ ...fine, regoStatus: "expired" }, TODAY)).toBe("Rego expired");
    expect(carPaperworkAlert({ ...fine, insuranceEndsOn: null }, TODAY)).toBe("No insurance");
    expect(carPaperworkAlert({ ...fine, regoExpiresOn: null, insuranceEndsOn: null }, TODAY)).toBe(
      "No rego",
    );
  });
});
