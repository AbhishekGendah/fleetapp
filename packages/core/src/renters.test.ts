import { describe, expect, it } from "vitest";

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
  it("lists every missing detail, in form order", () => {
    expect(
      detailsStillNeeded({
        dateOfBirth: null,
        residentialAddress: null,
        hasLicence: false,
        hasBothLicenceScans: false,
      }),
    ).toEqual(["dateOfBirth", "residentialAddress", "licence", "licenceScans"]);
  });

  it("is empty once everything is on file", () => {
    expect(
      detailsStillNeeded({
        dateOfBirth: "2000-01-01",
        residentialAddress: "1 Test Street, Perth WA 6000",
        hasLicence: true,
        hasBothLicenceScans: true,
      }),
    ).toEqual([]);
  });
});

describe("a Renter's display name", () => {
  it("adds the preferred name only when it is different", () => {
    expect(renterDisplayName("Samantha Example", "Sam")).toBe("Samantha Example (Sam)");
    expect(renterDisplayName("Sam Example", "Sam Example")).toBe("Sam Example");
    expect(renterDisplayName("Sam Example", null)).toBe("Sam Example");
  });
});
