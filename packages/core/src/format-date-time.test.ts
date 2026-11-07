import { describe, expect, it } from "vitest";

import {
  formatCalendarDate,
  formatDateTimeInTimeZone,
  formatDayInTimeZone,
  formatLinkExpiryInTimeZone,
  formatMonthYearInTimeZone,
  formatShortCalendarDate,
  formatShortDayInTimeZone,
  formatTimeInTimeZone,
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

describe("short days and times for a line of a list", () => {
  it("reads a plain date as its weekday, day and month, with the year only when it is another", () => {
    expect(formatShortCalendarDate("2026-11-12", "2026-11-06")).toBe("Thu 12 Nov");
    expect(formatShortCalendarDate("2025-11-12", "2026-11-06")).toBe("Wed 12 Nov 2025");
  });

  it("puts a moment on the Operator's day, across midnight", () => {
    // 1:30 pm UTC on Friday is 12:30 am on Saturday in Sydney, still Friday in Perth.
    const lateUtc = new Date("2026-11-06T13:30:00Z");
    expect(formatShortDayInTimeZone(lateUtc, "Australia/Sydney", "2026-11-06")).toBe("Sat 7 Nov");
    expect(formatShortDayInTimeZone(lateUtc, "Australia/Perth", "2026-11-06")).toBe("Fri 6 Nov");
  });

  it("shows the time on the Operator's clock", () => {
    const moment = new Date("2026-11-06T04:30:00Z");
    expect(formatTimeInTimeZone(moment, "Australia/Sydney")).toBe("3:30 pm");
    expect(formatTimeInTimeZone(moment, "Australia/Perth")).toBe("12:30 pm");
  });
});

describe("a month and year", () => {
  it("is the month on the Operator's clock, not UTC's", () => {
    // 31 Oct 2026, 3:00 pm UTC: already 1 Nov in Sydney, still 31 Oct in Perth.
    const moment = new Date("2026-10-31T15:00:00Z");
    expect(formatMonthYearInTimeZone(moment, "Australia/Sydney")).toBe("Nov 2026");
    expect(formatMonthYearInTimeZone(moment, "Australia/Perth")).toBe("Oct 2026");
    expect(formatMonthYearInTimeZone(new Date("2026-03-15T02:00:00Z"), "Australia/Perth")).toBe(
      "Mar 2026",
    );
  });
});
