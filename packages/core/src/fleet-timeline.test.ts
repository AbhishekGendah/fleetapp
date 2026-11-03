import { describe, expect, it } from "vitest";

import { mondayOf, timelineStart } from "./fleet-timeline";

const PERTH = "Australia/Perth";
const SYDNEY = "Australia/Sydney";

describe("the fleet timeline's weeks", () => {
  it("finds the Monday on or before any day, across months and years", () => {
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
    expect(mondayOf("2027-01-02")).toBe("2026-12-28");
    expect(mondayOf("2023-12-31")).toBe("2023-12-25");
  });

  it("starts this week, or a later week asked for, on the Operator's clock", () => {
    // Sunday 8 Nov, 11pm in Perth is already Monday 9 Nov in Sydney.
    const lateSunday = new Date("2026-11-08T15:30:00Z");
    expect(timelineStart(undefined, lateSunday, PERTH)).toBe("2026-11-02");
    expect(timelineStart(undefined, lateSunday, SYDNEY)).toBe("2026-11-09");
    expect(timelineStart("2026-11-25", lateSunday, PERTH)).toBe("2026-11-23");
  });

  it("never goes back before this week, and ignores a date that is not one", () => {
    const now = new Date("2026-11-03T02:00:00Z");
    expect(timelineStart("2026-10-01", now, PERTH)).toBe("2026-11-02");
    expect(timelineStart("2026-02-30", now, PERTH)).toBe("2026-11-02");
    expect(timelineStart("next week", now, PERTH)).toBe("2026-11-02");
  });
});
