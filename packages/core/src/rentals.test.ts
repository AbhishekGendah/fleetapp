import { describe, expect, it } from "vitest";

import {
  bookingProblems,
  canMoveRental,
  isBookingRefused,
  isHandoverAllowed,
  isValidRentalPeriod,
  RENTAL_STATUSES,
  weekdayIn,
  type BookingCheckInput,
} from "./rentals";
import { operatorSettingsSchema, readSettings } from "./settings";

const READY_RENTER: BookingCheckInput["renter"] = {
  status: "active",
  dateOfBirth: "1990-05-20",
  residentialAddress: "1 Example Street, Perth WA 6000",
  licenceType: "full",
  licenceExpiresOn: "2030-01-01",
  hasBothLicenceScans: true,
};

function check(overrides: Partial<BookingCheckInput> = {}) {
  return bookingProblems({
    renter: READY_RENTER,
    carStatus: "available",
    startDate: "2026-11-10",
    endDate: "2026-12-10",
    today: "2026-11-01",
    rules: { minimumRenterAgeYears: 21, isProvisionalLicenceAllowed: false },
    ...overrides,
  });
}

describe("rental status moves", () => {
  it("allows only the moves along the way", () => {
    expect(canMoveRental("draft", "booked")).toBe(true);
    expect(canMoveRental("booked", "active")).toBe(true);
    expect(canMoveRental("active", "returned")).toBe(true);
    expect(canMoveRental("returned", "closed")).toBe(true);
    expect(canMoveRental("draft", "active")).toBe(false);
    expect(canMoveRental("returned", "active")).toBe(false);
  });

  it("allows cancelling only before the car changes hands", () => {
    expect(canMoveRental("draft", "cancelled")).toBe(true);
    expect(canMoveRental("booked", "cancelled")).toBe(true);
    expect(canMoveRental("active", "cancelled")).toBe(false);
  });

  it("never moves a closed or cancelled rental", () => {
    for (const status of RENTAL_STATUSES) {
      expect(canMoveRental("closed", status)).toBe(false);
      expect(canMoveRental("cancelled", status)).toBe(false);
    }
  });
});

describe("weekdays on the Operator's clock", () => {
  it("uses the local day, not the UTC one", () => {
    // 10:30 pm Sunday in UTC is Monday morning in Sydney.
    const moment = new Date("2026-11-08T22:30:00Z");
    expect(weekdayIn(moment, "Australia/Sydney")).toBe(1);
    expect(weekdayIn(moment, "UTC")).toBe(7);
  });

  it("keeps the right day across the daylight-saving change", () => {
    // Sunday 5 April 2026: Sydney's clocks go back at 3 am.
    expect(weekdayIn(new Date("2026-04-04T16:30:00Z"), "Australia/Sydney")).toBe(7);
  });
});

describe("rental periods", () => {
  const start = new Date("2026-11-10T01:00:00Z");
  it("needs a later end for a fixed term, and none for ongoing", () => {
    expect(isValidRentalPeriod("fixed_term", start, new Date("2026-11-17T01:00:00Z"))).toBe(true);
    expect(isValidRentalPeriod("fixed_term", start, start)).toBe(false);
    expect(isValidRentalPeriod("fixed_term", start, null)).toBe(false);
    expect(isValidRentalPeriod("ongoing", start, null)).toBe(true);
    expect(isValidRentalPeriod("ongoing", start, new Date("2026-11-17T01:00:00Z"))).toBe(false);
  });
});

describe("booking checks", () => {
  it("finds nothing for a ready Renter and an available car", () => {
    expect(check()).toEqual([]);
  });

  it("refuses the booking for a do-not-rent Renter or a car that has left the fleet", () => {
    const problems = check({
      renter: { ...READY_RENTER, status: "do_not_rent" },
      carStatus: "sold",
    });
    expect(problems.map((problem) => problem.code)).toEqual(["do_not_rent", "car_not_rentable"]);
    expect(isBookingRefused(problems)).toBe(true);
  });

  it("allows booking a car in service, but not handing it over", () => {
    const problems = check({ carStatus: "in_service" });
    expect(isBookingRefused(problems)).toBe(false);
    expect(isHandoverAllowed(problems)).toBe(false);
  });

  it("stops the handover while details are missing", () => {
    const problems = check({
      renter: { ...READY_RENTER, hasBothLicenceScans: false, dateOfBirth: null },
    });
    expect(problems).toContainEqual({
      code: "details_missing",
      level: "handover",
      missing: ["licenceScans", "dateOfBirth"],
    });
  });

  it("stops the handover when the licence will have expired by the start", () => {
    const problems = check({ renter: { ...READY_RENTER, licenceExpiresOn: "2026-11-05" } });
    expect(problems.map((problem) => problem.code)).toContain("licence_expired_by_start");
    expect(isHandoverAllowed(problems)).toBe(false);
  });

  it("only warns when the licence expires during the rental or an ongoing one", () => {
    const during = check({ renter: { ...READY_RENTER, licenceExpiresOn: "2026-11-30" } });
    expect(during.map((problem) => problem.code)).toEqual(["licence_expires_during"]);
    expect(isHandoverAllowed(during)).toBe(true);
    const ongoing = check({ endDate: null });
    expect(ongoing.map((problem) => problem.code)).toEqual(["licence_expires_during"]);
  });

  it("checks age on the start date, birthdays counting on the day", () => {
    const turningTwentyOne = { ...READY_RENTER, dateOfBirth: "2005-11-10" };
    expect(check({ renter: turningTwentyOne })).toEqual([]);
    expect(
      check({ renter: turningTwentyOne, startDate: "2026-11-09" }).map((problem) => problem.code),
    ).toContain("under_minimum_age");
  });

  it("stops a provisional licence unless the Operator allows them", () => {
    const provisional = { ...READY_RENTER, licenceType: "provisional" as const };
    expect(check({ renter: provisional }).map((problem) => problem.code)).toEqual([
      "provisional_licence",
    ]);
    expect(
      check({
        renter: provisional,
        rules: { minimumRenterAgeYears: 21, isProvisionalLicenceAllowed: true },
      }),
    ).toEqual([]);
  });
});

describe("rental settings", () => {
  it("start with the design's defaults", () => {
    const settings = readSettings(operatorSettingsSchema, {});
    expect(settings).toMatchObject({
      minimumRenterAgeYears: 21,
      isProvisionalLicenceAllowed: false,
      fixedChargeWeekday: null,
      partWeekCharging: "daily_pro_rata",
      isBondRequiredBeforeHandover: true,
      bondHoldDaysAfterReturn: 28,
      ongoingNoticeDays: 7,
    });
  });

  it("refuse an age below any state's driving age", () => {
    expect(() => readSettings(operatorSettingsSchema, { minimumRenterAgeYears: 15 })).toThrow();
  });
});
