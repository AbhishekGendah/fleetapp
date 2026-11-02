import { describe, expect, it } from "vitest";

import { daysBetween } from "./calendar-dates";
import { dashboardWindow, idleDays, rentalMomentOf, startOfDayIn } from "./dashboard";

const PERTH = "Australia/Perth";
const SYDNEY = "Australia/Sydney";

/** 9:30am on 2 Nov 2026 in Perth (UTC+8). */
const PERTH_MORNING = new Date("2026-11-02T01:30:00Z");
const window = dashboardWindow(PERTH_MORNING, PERTH);

function at(iso: string): Date {
  return new Date(iso);
}

describe("the dashboard's week", () => {
  it("runs from the Operator's today to the start of the seventh day after", () => {
    expect(window.today).toBe("2026-11-02");
    expect(window.todayEnds).toEqual(at("2026-11-02T16:00:00Z"));
    expect(window.weekEnds).toEqual(at("2026-11-08T16:00:00Z"));
  });

  it("uses the Operator's date, not the server's, just after midnight", () => {
    // 12:10am on 3 Nov in Perth is still 2 Nov in UTC.
    expect(dashboardWindow(at("2026-11-02T16:10:00Z"), PERTH).today).toBe("2026-11-03");
  });

  it("starts each day at local midnight across a daylight saving change", () => {
    // Sydney moves to UTC+11 at 2am on 4 Oct 2026.
    expect(startOfDayIn("2026-10-04", SYDNEY)).toEqual(at("2026-10-03T14:00:00Z"));
    expect(startOfDayIn("2026-10-05", SYDNEY)).toEqual(at("2026-10-04T13:00:00Z"));
  });
});

describe("where a rental stands this week", () => {
  const active = (plannedEnd: Date | null) => ({
    status: "active" as const,
    plannedStart: at("2026-10-01T02:00:00Z"),
    plannedEnd,
  });
  const booked = (plannedStart: Date) => ({
    status: "booked" as const,
    plannedStart,
    plannedEnd: null,
  });

  it("an active rental past its end is overdue; later today is returning today", () => {
    expect(rentalMomentOf(active(at("2026-11-01T02:00:00Z")), window)).toBe("overdue");
    expect(rentalMomentOf(active(at("2026-11-02T09:00:00Z")), window)).toBe("returning_today");
    expect(rentalMomentOf(active(at("2026-11-05T02:00:00Z")), window)).toBe("ending_this_week");
  });

  it("an ongoing rental, or one ending after this week, needs nothing", () => {
    expect(rentalMomentOf(active(null), window)).toBeNull();
    expect(rentalMomentOf(active(at("2026-11-08T16:00:00Z")), window)).toBeNull();
  });

  it("a booking past its start is a late pickup; later today is a pickup today", () => {
    expect(rentalMomentOf(booked(at("2026-11-02T01:00:00Z")), window)).toBe("late_pickup");
    expect(rentalMomentOf(booked(at("2026-11-02T10:00:00Z")), window)).toBe("pickup_today");
    expect(rentalMomentOf(booked(at("2026-11-04T02:00:00Z")), window)).toBe("starting_this_week");
    expect(rentalMomentOf(booked(at("2026-11-09T02:00:00Z")), window)).toBeNull();
  });

  it("drafts and finished rentals are never on it", () => {
    expect(
      rentalMomentOf({ ...booked(at("2026-11-02T10:00:00Z")), status: "draft" }, window),
    ).toBeNull();
    expect(
      rentalMomentOf({ ...active(at("2026-11-01T02:00:00Z")), status: "cancelled" }, window),
    ).toBeNull();
  });
});

describe("idle days", () => {
  it("counts calendar days where the Operator is", () => {
    // Returned 11pm on 31 Oct in Perth (still 31 Oct there): two days by 2 Nov.
    expect(idleDays(at("2026-10-31T15:00:00Z"), PERTH_MORNING, PERTH)).toBe(2);
    expect(idleDays(PERTH_MORNING, PERTH_MORNING, PERTH)).toBe(0);
  });

  it("is never below nothing", () => {
    expect(idleDays(at("2026-11-05T00:00:00Z"), PERTH_MORNING, PERTH)).toBe(0);
  });

  it("days between dates", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-11-02", "2026-11-02")).toBe(0);
  });
});
