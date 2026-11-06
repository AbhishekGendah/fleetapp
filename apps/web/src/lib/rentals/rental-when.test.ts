import { describe, expect, it } from "vitest";

import { rentalWhenWords, type RentalWhenInput } from "./rental-when";

/** Fri 6 Nov 2026, 10:00 am in Perth. */
const CLOCK = { timeZone: "Australia/Perth", now: new Date("2026-11-06T02:00:00Z") };

function rental(changes: Partial<RentalWhenInput>): RentalWhenInput {
  return {
    status: "booked",
    plannedStart: new Date("2026-11-07T01:00:00Z"),
    plannedEnd: new Date("2026-11-14T01:00:00Z"),
    handedOverAt: null,
    returnedAt: null,
    ...changes,
  };
}

describe("the Rentals list's When", () => {
  it("says when a booking or draft starts, with its time", () => {
    expect(rentalWhenWords(rental({}), CLOCK).text).toBe("Starts Sat 7 Nov, 9:00 am");
    expect(
      rentalWhenWords(
        rental({ status: "draft", plannedStart: new Date("2026-11-06T06:30:00Z") }),
        CLOCK,
      ).text,
    ).toBe("Starts today, 2:30 pm");
  });

  it("says since when an ongoing rental is out", () => {
    const words = rentalWhenWords(
      rental({
        status: "active",
        plannedStart: new Date("2026-11-06T01:00:00Z"),
        handedOverAt: new Date("2026-11-06T01:10:00Z"),
        plannedEnd: null,
      }),
      CLOCK,
    );
    expect(words).toEqual({
      text: "Since today, ongoing",
      shortText: "Since today, ongoing",
    });
  });

  it("gives a rental out its span, and on a phone only when it is back", () => {
    const words = rentalWhenWords(
      rental({
        status: "active",
        handedOverAt: new Date("2026-10-09T01:00:00Z"),
        plannedEnd: new Date("2026-11-10T01:00:00Z"),
      }),
      CLOCK,
    );
    expect(words).toEqual({ text: "Fri 9 Oct to Tue 10 Nov", shortText: "Back Tue 10 Nov" });
  });

  it("says a rental back today with the time, and one past its end as due back", () => {
    const backToday = rental({
      status: "active",
      handedOverAt: new Date("2026-10-30T01:00:00Z"),
      plannedEnd: new Date("2026-11-06T07:30:00Z"),
    });
    expect(rentalWhenWords(backToday, CLOCK).text).toBe("Back today 3:30 pm");
    const late = { ...backToday, plannedEnd: new Date("2026-11-03T01:00:00Z") };
    expect(rentalWhenWords(late, CLOCK).text).toBe("Was due back Tue 3 Nov");
  });

  it("says when a rental to close came back, and a finished one's span", () => {
    const returnedAt = new Date("2026-11-03T05:00:00Z");
    expect(rentalWhenWords(rental({ status: "returned", returnedAt }), CLOCK).text).toBe(
      "Returned Tue 3 Nov",
    );
    expect(
      rentalWhenWords(
        rental({
          status: "closed",
          handedOverAt: new Date("2026-09-01T01:00:00Z"),
          returnedAt: new Date("2026-09-29T01:00:00Z"),
        }),
        CLOCK,
      ).text,
    ).toBe("Tue 1 Sep to Tue 29 Sep");
    expect(rentalWhenWords(rental({ status: "cancelled", plannedEnd: null }), CLOCK).text).toBe(
      "From Sat 7 Nov",
    );
  });

  it("reads the day on the Operator's clock, and names another year", () => {
    // 4:30 pm UTC on the 6th is already the 7th in Perth.
    expect(
      rentalWhenWords(rental({ plannedStart: new Date("2026-11-06T16:30:00Z") }), CLOCK).text,
    ).toBe("Starts Sat 7 Nov, 12:30 am");
    expect(
      rentalWhenWords(rental({ plannedStart: new Date("2027-01-04T01:00:00Z") }), CLOCK).text,
    ).toBe("Starts Mon 4 Jan 2027, 9:00 am");
  });
});
