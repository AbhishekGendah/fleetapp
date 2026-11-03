import { describe, expect, it } from "vitest";

import {
  isInStatusGroup,
  mondayOf,
  timelineCellWidth,
  timelineWindow,
  TIMELINE_ZOOM_LEVELS,
} from "./fleet-timeline";

const PERTH = "Australia/Perth";
const SYDNEY = "Australia/Sydney";
const ROW_HEADER = 96;

describe("the fleet timeline", () => {
  it("finds the Monday on or before any day, across months and years", () => {
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
    expect(mondayOf("2027-01-02")).toBe("2026-12-28");
    expect(mondayOf("2023-12-31")).toBe("2023-12-25");
  });

  it("loads a quarter back and half a year ahead of today, on the Operator's clock", () => {
    // Sunday 8 Nov, 11:30pm in Perth is already Monday 9 Nov in Sydney.
    const lateSunday = new Date("2026-11-08T15:30:00Z");
    expect(timelineWindow(undefined, lateSunday, PERTH)).toEqual({
      startDate: "2026-08-03",
      days: 273,
      focusDate: "2026-11-08",
      today: "2026-11-08",
    });
    expect(timelineWindow(undefined, lateSunday, SYDNEY)).toMatchObject({
      startDate: "2026-08-10",
      focusDate: "2026-11-09",
    });
  });

  it("centres on a date asked for, past or future, and ignores one that is not a date", () => {
    const now = new Date("2026-11-03T02:00:00Z");
    expect(timelineWindow("2026-02-11", now, PERTH)).toMatchObject({
      startDate: "2025-11-10",
      focusDate: "2026-02-11",
      today: "2026-11-03",
    });
    expect(timelineWindow("2026-02-30", now, PERTH).focusDate).toBe("2026-11-03");
    expect(timelineWindow("next week", now, PERTH).focusDate).toBe("2026-11-03");
  });

  it("fills a wide box and stops shrinking at a readable width on a phone", () => {
    // A 1,920px screen at Days: two weeks across, wider than the minimum.
    expect(timelineCellWidth(1920, ROW_HEADER, "days")).toBe(130);
    // A phone at Days: the minimum, and the timeline swipes.
    expect(timelineCellWidth(343, ROW_HEADER, "days")).toBe(
      TIMELINE_ZOOM_LEVELS.days.minimumCellWidth,
    );
    expect(timelineCellWidth(1920, ROW_HEADER, "months")).toBe(70);
    expect(timelineCellWidth(343, ROW_HEADER, "weeks")).toBe(16);
  });

  it("groups In service and Off road as Workshop", () => {
    expect(isInStatusGroup("off_road", "workshop")).toBe(true);
    expect(isInStatusGroup("in_service", "workshop")).toBe(true);
    expect(isInStatusGroup("rented", "out")).toBe(true);
    expect(isInStatusGroup("rented", "available")).toBe(false);
    expect(isInStatusGroup("sold", "all")).toBe(true);
  });
});
