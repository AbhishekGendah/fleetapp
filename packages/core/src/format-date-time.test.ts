import { describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  formatDateTimeInTimeZone,
  formatDayInTimeZone,
  formatLinkExpiryInTimeZone,
} from "./format-date-time";

describe("formatting a moment in the Operator's timezone", () => {
  const moment = new Date("2026-10-27T06:15:00Z");

  it("shows the Operator's own clock", () => {
    expect(formatDateTimeInTimeZone(moment, "Australia/Perth")).toContain("2:15");
    expect(formatDateTimeInTimeZone(moment, "Australia/Sydney")).toContain("5:15");
  });

  it("crosses midnight into the right date", () => {
    const lateUtc = new Date("2026-10-27T15:30:00Z");

    expect(formatDateTimeInTimeZone(lateUtc, "Australia/Sydney")).toContain("28 Oct 2026");
    expect(formatDateTimeInTimeZone(lateUtc, "Australia/Perth")).toContain("27 Oct 2026");
  });
});

describe("formatCalendarDate", () => {
  it("shows the same day whatever the reader's timezone", () => {
    expect(formatCalendarDate("2026-11-01")).toBe("1 Nov 2026");
  });
});

describe("a day in words", () => {
  it("is on the Operator's clock", () => {
    // 2026-11-05 at 20:00 UTC is already Friday 6 November in Perth.
    expect(formatDayInTimeZone(new Date("2026-11-05T20:00:00Z"), "Australia/Perth")).toBe(
      "Friday 6 November",
    );
  });

  it("says the time and day a link stops working (review A11-5)", () => {
    // 3:15 pm in Sydney on Friday 13 November 2026, daylight time.
    expect(formatLinkExpiryInTimeZone(new Date("2026-11-13T04:15:00Z"), "Australia/Sydney")).toBe(
      "3:15 pm AEDT, Friday 13 November",
    );
  });
});
