import { describe, expect, it } from "vitest";

import {
  calendarMoments,
  momentLabel,
  momentsByDay,
  monthLabel,
  spanLabel,
  weekDays,
} from "./calendar-moments";
import type { CalendarBooking } from "./rental-queries";

const TIME_ZONE = "Australia/Perth";
const WINDOW = { from: new Date("2026-10-26T00:00:00Z"), to: new Date("2026-12-07T00:00:00Z") };

function booking(changes: Partial<CalendarBooking>): CalendarBooking {
  return {
    rentalId: "rental-1",
    status: "booked",
    renterId: "renter-1",
    vehicleId: "car-1",
    rego: "1ABC234",
    make: "Toyota",
    model: "Corolla",
    renterFullName: "Jamie Park",
    renterPreferredName: null,
    // 10:00 am Fri 6 Nov in Perth, to 3:30 pm Tue 10 Nov.
    heldFrom: new Date("2026-11-06T02:00:00Z"),
    heldUntil: new Date("2026-11-10T07:30:00Z"),
    ...changes,
  };
}

describe("the calendar's handovers and returns", () => {
  it("gives a booking its handover and return, each on its day on the Operator's clock", () => {
    const moments = calendarMoments([booking({})], WINDOW, TIME_ZONE);
    expect(moments.map((moment) => [moment.kind, moment.day, moment.time])).toEqual([
      ["handover", "2026-11-06", "10:00 am"],
      ["return", "2026-11-10", "3:30 pm"],
    ]);
    expect(momentLabel(moments[0]!)).toBe("10:00 am Handover · Jamie · 1ABC234");
    expect(moments[1]?.makeModel).toBe("Toyota Corolla");
  });

  it("gives an ongoing rental only its handover, and leaves out what is outside the window", () => {
    const ongoing = booking({ rentalId: "rental-2", heldUntil: null });
    const before = booking({
      rentalId: "rental-3",
      heldFrom: new Date("2026-09-01T02:00:00Z"),
      heldUntil: new Date("2026-11-02T02:00:00Z"),
    });
    const moments = calendarMoments([ongoing, before], WINDOW, TIME_ZONE);
    expect(moments.map((moment) => `${moment.rentalId} ${moment.kind}`)).toEqual([
      "rental-3 return",
      "rental-2 handover",
    ]);
  });

  it("puts a moment late in the UTC day on the next day where the Operator is", () => {
    const late = booking({ heldFrom: new Date("2026-11-06T16:30:00Z"), heldUntil: null });
    expect(calendarMoments([late], WINDOW, TIME_ZONE)[0]?.day).toBe("2026-11-07");
  });

  it("groups the moments by day, in time order, leaving out empty days", () => {
    const first = booking({});
    const second = booking({
      rentalId: "rental-2",
      heldFrom: new Date("2026-11-06T01:00:00Z"),
      heldUntil: null,
    });
    const byDay = momentsByDay(calendarMoments([first, second], WINDOW, TIME_ZONE));
    expect([...byDay.keys()]).toEqual(["2026-11-06", "2026-11-10"]);
    expect(byDay.get("2026-11-06")?.map((moment) => moment.rentalId)).toEqual([
      "rental-2",
      "rental-1",
    ]);
  });

  it("lays a week out Monday first, across a month's end", () => {
    expect(weekDays("2026-11-06")).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(weekDays("2026-12-01")[0]).toBe("2026-11-30");
  });

  it("names a month, and a stretch of days within a month or across two", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(spanLabel("2026-11-02", "2026-11-08")).toBe("2 to 8 November");
    expect(spanLabel("2026-11-30", "2026-12-06")).toBe("30 Nov to 6 Dec");
  });
});
