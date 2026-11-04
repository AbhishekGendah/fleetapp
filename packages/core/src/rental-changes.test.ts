import { describe, expect, it } from "vitest";

import { canChangeEnd, canChangeRate, endChangeProblem, noticeDaysShort } from "./rental-changes";

const NOW = new Date("2026-11-02T02:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

describe("changes of terms", () => {
  const rental = { plannedStart: daysFromNow(-10), plannedEnd: daysFromNow(20) };

  it("allows end changes on bookings and rentals out, rate changes only once out", () => {
    expect(canChangeEnd("booked")).toBe(true);
    expect(canChangeEnd("active")).toBe(true);
    expect(canChangeEnd("returned")).toBe(false);
    expect(canChangeRate("booked")).toBe(false);
    expect(canChangeRate("active")).toBe(true);
  });

  it("wants a new end in the future, after the start and different", () => {
    expect(endChangeProblem(daysFromNow(-1), rental, NOW)).toBe("in_past");
    expect(endChangeProblem(NOW, rental, NOW)).toBe("in_past");
    expect(
      endChangeProblem(daysFromNow(3), { plannedStart: daysFromNow(5), plannedEnd: null }, NOW),
    ).toBe("before_start");
    expect(endChangeProblem(daysFromNow(20), rental, NOW)).toBe("unchanged");
    expect(endChangeProblem(daysFromNow(5), rental, NOW)).toBeNull();
    expect(endChangeProblem(daysFromNow(40), rental, NOW)).toBeNull();
  });

  it("counts notice short only when an ongoing rental is given an end", () => {
    expect(noticeDaysShort(daysFromNow(3), { type: "ongoing" }, NOW, 7)).toBe(4);
    expect(noticeDaysShort(daysFromNow(7), { type: "ongoing" }, NOW, 7)).toBe(0);
    expect(noticeDaysShort(daysFromNow(3), { type: "fixed_term" }, NOW, 7)).toBe(0);
  });
});
