import { describe, expect, it } from "vitest";

import { insuranceFact, odometerFact, priceFact, regoFact } from "./car-page-facts";

/** Fri 6 Nov 2026, 10:00 am in Perth. */
const CLOCK = { timeZone: "Australia/Perth", now: new Date("2026-11-06T02:00:00Z") };
const TODAY = "2026-11-06";

describe("a car's strip facts", () => {
  it("gives the odometer with where and when it was read", () => {
    expect(
      odometerFact(
        { kilometres: 24310, recordedAt: new Date("2026-11-06T02:12:00Z"), source: "handover" },
        CLOCK,
      ),
    ).toEqual({ label: "Odometer", value: "24,310 km", note: "At handover Fri 6 Nov" });
    expect(odometerFact(null, CLOCK)).toEqual({ label: "Odometer", value: "Not recorded" });
  });

  it("says when the rego is due, or that it is on direct debit or missing", () => {
    const rego = { isOnDirectDebit: false, state: "VIC", status: "current" } as const;
    expect(regoFact({ ...rego, expiresOn: "2026-11-12", status: "due_soon" }, TODAY)).toEqual({
      label: "Rego",
      value: "Thu 12 Nov",
      note: "Due in 6 days · VIC",
    });
    expect(regoFact({ ...rego, expiresOn: "2026-11-07", status: "due_soon" }, TODAY).note).toBe(
      "Due in 1 day · VIC",
    );
    expect(regoFact({ ...rego, expiresOn: "2027-08-02" }, TODAY)).toEqual({
      label: "Rego",
      value: "Mon 2 Aug 2027",
      note: "VIC",
    });
    expect(regoFact({ ...rego, expiresOn: "2026-11-01", status: "expired" }, TODAY).note).toBe(
      "Expired · VIC",
    );
    expect(regoFact({ ...rego, isOnDirectDebit: true, expiresOn: null }, TODAY).value).toBe(
      "Direct debit",
    );
    expect(regoFact({ ...rego, expiresOn: null }, TODAY).value).toBe("Missing");
  });

  it("names the insurer under the insurance's end", () => {
    expect(
      insuranceFact({ endsOn: "2027-06-30", status: "current", insurer: "Allianz" }, TODAY),
    ).toEqual({ label: "Insurance", value: "Wed 30 Jun 2027", note: "Allianz" });
    expect(
      insuranceFact({ endsOn: "2026-11-06", status: "due_soon", insurer: "Allianz" }, TODAY).note,
    ).toBe("Due today · Allianz");
    expect(insuranceFact({ endsOn: null, status: "current", insurer: null }, TODAY)).toEqual({
      label: "Insurance",
      value: "Missing",
    });
  });

  it("gives the weekly price with the daily rate under it", () => {
    expect(priceFact({ dailyRateCents: 6000, longTermWeeklyCents: 35000 })).toEqual({
      label: "Price",
      value: "$350.00/wk",
      note: "$60.00 a day",
    });
    expect(priceFact({ dailyRateCents: 6000, longTermWeeklyCents: null }).value).toBe("$60.00/day");
    expect(priceFact({ dailyRateCents: null, longTermWeeklyCents: null }).value).toBe("Not set");
  });
});
