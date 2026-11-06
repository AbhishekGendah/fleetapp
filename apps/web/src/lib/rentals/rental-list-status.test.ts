import { RENTAL_STATUSES } from "@fleetapp/core";
import { describe, expect, it } from "vitest";

import {
  RENTAL_LIST_STATUSES,
  RENTAL_STATUS_BADGES,
  RENTAL_STATUSES_OF,
  rentalListStatusCounts,
  rentalListStatusOf,
} from "./rental-list-status";

describe("the Rentals list's status filters", () => {
  it("puts every status in exactly one filter", () => {
    const grouped = RENTAL_LIST_STATUSES.flatMap((group) => RENTAL_STATUSES_OF[group]);
    expect([...grouped].sort()).toEqual([...RENTAL_STATUSES].sort());
  });

  it("opens the plain-words filters, and the old status addresses still land on theirs", () => {
    expect(rentalListStatusOf("to-close")).toBe("to-close");
    expect(rentalListStatusOf("active")).toBe("out");
    expect(rentalListStatusOf("returned")).toBe("to-close");
    expect(rentalListStatusOf("closed")).toBe("finished");
    expect(rentalListStatusOf("cancelled")).toBe("finished");
    expect(rentalListStatusOf("booked")).toBe("booked");
    expect(rentalListStatusOf("draft")).toBe("draft");
  });

  it("ignores what is not a filter", () => {
    expect(rentalListStatusOf(undefined)).toBeUndefined();
    expect(rentalListStatusOf("everything")).toBeUndefined();
  });

  it("counts Finished as closed and cancelled together", () => {
    expect(rentalListStatusCounts({ active: 3, closed: 1, cancelled: 2 })).toEqual({
      out: 3,
      booked: 0,
      draft: 0,
      "to-close": 0,
      finished: 3,
    });
  });

  it("labels a cancelled rental Cancelled, not Finished, and a returned one To close", () => {
    expect(RENTAL_STATUS_BADGES.cancelled.text).toBe("Cancelled");
    expect(RENTAL_STATUS_BADGES.returned).toEqual({ text: "To close", tone: "attention" });
    expect(RENTAL_STATUS_BADGES.active).toEqual({ text: "Out", tone: "out" });
  });
});
