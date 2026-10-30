import { describe, expect, it } from "vitest";

import { countryName, isOverseasCountryCode, overseasCountryOptions } from "./countries";
import { ageOn, detailsStillNeeded, renterDisplayName } from "./renters";

describe("a Renter's age", () => {
  it("goes up on the birthday itself, not the day after", () => {
    expect(ageOn("2000-10-30", "2026-10-29")).toBe(25);
    expect(ageOn("2000-10-30", "2026-10-30")).toBe(26);
  });

  it("treats a 29 February birthday as reached on 1 March in other years", () => {
    expect(ageOn("2004-02-29", "2025-02-28")).toBe(20);
    expect(ageOn("2004-02-29", "2025-03-01")).toBe(21);
  });
});

describe("what is still needed before renting", () => {
  const complete = {
    dateOfBirth: "2000-01-01",
    residentialAddress: "1 Test Street, Perth WA 6000",
    licenceExpiresOn: "2027-01-01",
    hasBothLicenceScans: true,
    today: "2026-10-30",
  };

  it("lists every missing detail, the licence first", () => {
    expect(
      detailsStillNeeded({
        ...complete,
        dateOfBirth: null,
        residentialAddress: null,
        licenceExpiresOn: null,
        hasBothLicenceScans: false,
      }),
    ).toEqual(["licence", "licenceScans", "dateOfBirth", "residentialAddress"]);
  });

  it("counts an expired licence as missing, but not one expiring today", () => {
    expect(detailsStillNeeded({ ...complete, licenceExpiresOn: "2026-10-29" })).toEqual([
      "currentLicence",
    ]);
    expect(detailsStillNeeded({ ...complete, licenceExpiresOn: "2026-10-30" })).toEqual([]);
  });

  it("is empty once everything is on file", () => {
    expect(detailsStillNeeded(complete)).toEqual([]);
  });
});

describe("a Renter's display name", () => {
  it("adds the preferred name only when it is different", () => {
    expect(renterDisplayName("Samantha Example", "Sam")).toBe("Samantha Example (Sam)");
    expect(renterDisplayName("Sam Example", "Sam Example")).toBe("Sam Example");
    expect(renterDisplayName("Sam Example", null)).toBe("Sam Example");
  });
});

describe("overseas countries", () => {
  it("names a country in Australian English, and leaves Australia out", () => {
    expect(countryName("NZ")).toBe("New Zealand");
    expect(isOverseasCountryCode("AU")).toBe(false);
    expect(overseasCountryOptions()[0]?.label).toBe("Afghanistan");
  });
});
