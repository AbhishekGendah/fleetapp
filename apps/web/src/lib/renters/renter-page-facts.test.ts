import { describe, expect, it } from "vitest";

import type { RentalSummary } from "../rentals/rental-queries";
import { licenceFact, rentingFact, renterOwingFact, withYouSinceFact } from "./renter-page-facts";

const TODAY = "2026-11-06";
const OVERDUE = { overdueCents: 450_00, daysLate: 9, oldestDueOn: "2026-10-28" };

describe("a Renter's strip facts", () => {
  it("says how late an overdue balance is, else since when it is owed", () => {
    const owing = { balanceCents: 450_00, oldestOwingOn: "2026-10-28" };
    expect(renterOwingFact(owing, OVERDUE, TODAY)).toEqual({
      label: "Owing",
      value: "$450.00",
      note: "9 days late",
    });
    expect(renterOwingFact(owing, null, TODAY).note).toBe("Since Wed 28 Oct");
    expect(renterOwingFact({ balanceCents: 0, oldestOwingOn: null }, null, TODAY).note).toBe(
      "All paid up",
    );
  });

  it("shows the licence's type, state and expiry, never its number", () => {
    const fact = licenceFact({
      licenceType: "full",
      licenceIssuedIn: "VIC",
      licenceCountry: null,
      licenceExpiresOn: "2029-03-14",
      status: "current",
    });
    expect(fact).toEqual({ label: "Licence", value: "Full · VIC", note: "Expires 14 Mar 2029" });
    expect(
      licenceFact({
        licenceType: null,
        licenceIssuedIn: null,
        licenceCountry: null,
        licenceExpiresOn: null,
        status: "none",
      }).value,
    ).toBe("Not on file");
  });

  it("says since when they have rented, and how many rentals", () => {
    const added = new Date("2026-07-06T06:00:00Z");
    expect(withYouSinceFact(added, 2, "Australia/Perth")).toEqual({
      label: "With you since",
      value: "Jul 2026",
      note: "2 rentals",
    });
    expect(withYouSinceFact(added, 1, "Australia/Perth").note).toBe("1 rental");
    expect(withYouSinceFact(added, 0, "Australia/Perth").note).toBe("No rentals yet");
  });
});

describe("what a Renter is renting, on their strip", () => {
  const car = { make: "Hyundai", model: "i30" } as RentalSummary;

  it("names the car and when it is back, or when a booking starts", () => {
    expect(
      rentingFact({
        rental: { ...car, status: "active" },
        words: "Fri 9 Oct to Tue 10 Nov",
        shortWords: "Back Tue 10 Nov",
      }),
    ).toEqual({ label: "Renting now", note: "Hyundai i30 · back Tue 10 Nov" });
    expect(
      rentingFact({
        rental: { ...car, status: "booked" },
        words: "Starts Sat 7 Nov, 9:00 am",
        shortWords: "Starts Sat 7 Nov, 9:00 am",
      }),
    ).toEqual({ label: "Booked", note: "Hyundai i30 · starts Sat 7 Nov, 9:00 am" });
  });

  it("says when they last had a car back", () => {
    expect(
      rentingFact({
        rental: null,
        words: "Last back Tue 29 Sep",
        shortWords: "Last back Tue 29 Sep",
      }),
    ).toEqual({ label: "Renting now", note: "Last back Tue 29 Sep" });
  });
});
