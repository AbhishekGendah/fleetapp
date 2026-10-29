import { describe, expect, it } from "vitest";

import { addDays, daysBetween, isCalendarDate, todayInTimeZone } from "./calendar-dates";
import { expiryStatus } from "./expiry";

describe("today where the Operator is", () => {
  it("is still yesterday in Perth when it is already tomorrow in Sydney", () => {
    // 15:30 UTC on 29 Oct: 23:30 in Perth, 02:30 on 30 Oct in Sydney (daylight saving).
    const moment = new Date("2026-10-29T15:30:00Z");
    expect(todayInTimeZone(moment, "Australia/Perth")).toBe("2026-10-29");
    expect(todayInTimeZone(moment, "Australia/Sydney")).toBe("2026-10-30");
  });
});

describe("calendar dates", () => {
  it("adds days across months and years", () => {
    expect(addDays("2026-10-29", 30)).toBe("2026-11-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-10-29", "2026-11-28")).toBe(30);
    expect(daysBetween("2026-10-29", "2026-10-28")).toBe(-1);
  });

  it("refuses dates that do not exist", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("29/10/2026")).toBe(false);
  });
});

describe("expiryStatus", () => {
  const today = "2026-10-29";

  it("is valid through the expiry date and expired the day after", () => {
    expect(expiryStatus("2026-10-29", today, 30)).toBe("due_soon");
    expect(expiryStatus("2026-10-28", today, 30)).toBe("expired");
  });

  it("is due soon inside the warning window, including its last day", () => {
    expect(expiryStatus("2026-11-28", today, 30)).toBe("due_soon");
    expect(expiryStatus("2026-11-29", today, 30)).toBe("current");
  });

  it("is none when nothing is recorded", () => {
    expect(expiryStatus(null, today, 30)).toBe("none");
  });
});
