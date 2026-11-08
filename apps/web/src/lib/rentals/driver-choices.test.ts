import { describe, expect, it } from "vitest";

import type { BusinessDriver } from "../renters/organisation-driver-queries";
import { driverChoiceOf, driverUnavailableReason } from "./driver-choices";

const EXPIRY = { today: "2026-11-08", warningDays: 30 };

function driver(changes: Partial<BusinessDriver> = {}): BusinessDriver {
  return {
    linkId: "link",
    driverId: "sam",
    fullName: "Sam Lee",
    preferredName: null,
    phone: "0412345678",
    status: "active",
    isArchived: false,
    licenceType: "full",
    licenceIssuedIn: "WA",
    licenceCountry: "AU",
    licenceExpiresOn: "2029-06-03",
    isWaitingReview: false,
    isNamedOnRental: false,
    addedAt: new Date("2026-11-01T01:00:00Z"),
    removedAt: null,
    ...changes,
  };
}

describe("a business's driver on the driver picker (mockup 5)", () => {
  it("offers a current driver with their licence in words, never its number", () => {
    const choice = driverChoiceOf(driver(), [], EXPIRY);

    expect(choice).toMatchObject({
      driverId: "sam",
      name: "Sam Lee",
      badge: { text: "Current" },
      carsOut: [],
      unavailableReason: null,
    });
    expect(choice.licenceWords).toContain("Full");
    expect(choice.licenceWords).toContain("to 3 June 2029");
    expect(JSON.stringify(choice)).not.toContain("licenceNumber");
  });

  it("keeps the cars they already have out, as a warning only", () => {
    const choice = driverChoiceOf(driver(), ["1BRT482"], EXPIRY);

    expect(choice.carsOut).toEqual(["1BRT482"]);
    expect(choice.unavailableReason).toBeNull();
  });

  it("can't name one whose details wait for review, or who is Do not rent", () => {
    expect(driverUnavailableReason(driver({ isWaitingReview: true }))).toBe(
      "Review the details Sam sent before naming them.",
    );
    expect(driverUnavailableReason(driver({ status: "do_not_rent" }))).toBe(
      "Marked Do not rent, so they can't be named.",
    );
    expect(driverUnavailableReason(driver())).toBeNull();
  });
});
