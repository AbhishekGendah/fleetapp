import { describe, expect, it } from "vitest";

import { headerSearchGroups } from "./header-search-groups";
import { headerSearchTextSchema } from "./header-search-input";

const CAR = { id: "car-1", rego: "1ABC234", make: "Toyota", model: "Corolla" };
const RENTER = { id: "renter-1", fullName: "Jamie Park", phone: "0412 345 678" };
const RENTAL = {
  id: "rental-1",
  status: "active" as const,
  renterFullName: "Jamie Park",
  rego: "1ABC234",
};

describe("the top bar's search results", () => {
  it("groups Cars, Renters and Rentals in that order, each a link to its page", () => {
    expect(headerSearchGroups({ cars: [CAR], renters: [RENTER], rentals: [RENTAL] })).toEqual([
      {
        label: "Cars",
        items: [{ key: "car-1", href: "/cars/car-1", title: "1ABC234", detail: "Toyota Corolla" }],
      },
      {
        label: "Renters",
        items: [
          {
            key: "renter-1",
            href: "/renters/renter-1",
            title: "Jamie Park",
            detail: "0412 345 678",
          },
        ],
      },
      {
        label: "Rentals",
        items: [
          {
            key: "rental-1",
            href: "/rentals/rental-1",
            title: "Jamie Park · 1ABC234",
            detail: "Out",
          },
        ],
      },
    ]);
  });

  it("leaves out kinds with nothing found", () => {
    const groups = headerSearchGroups({ cars: [], renters: [RENTER], rentals: [] });
    expect(groups.map((group) => group.label)).toEqual(["Renters"]);
  });

  it("finds nothing to show when nothing matched", () => {
    expect(headerSearchGroups({ cars: [], renters: [], rentals: [] })).toEqual([]);
  });

  it("gives a Renter with no phone an empty second line", () => {
    const [group] = headerSearchGroups({
      cars: [],
      renters: [{ ...RENTER, phone: null }],
      rentals: [],
    });
    expect(group?.items[0]?.detail).toBe("");
  });

  it("words a rental's status as the Rentals list does", () => {
    const [group] = headerSearchGroups({
      cars: [],
      renters: [],
      rentals: [{ ...RENTAL, status: "returned" }],
    });
    expect(group?.items[0]?.detail).toBe("To close");
  });
});

describe("what the top bar's search accepts", () => {
  it("trims the text", () => {
    expect(headerSearchTextSchema.parse("  1abc ")).toBe("1abc");
  });

  it("refuses under two characters, spaces not counted", () => {
    expect(headerSearchTextSchema.safeParse("a").success).toBe(false);
    expect(headerSearchTextSchema.safeParse(" a  ").success).toBe(false);
  });

  it("refuses more than 60 characters", () => {
    expect(headerSearchTextSchema.safeParse("a".repeat(61)).success).toBe(false);
    expect(headerSearchTextSchema.safeParse("a".repeat(60)).success).toBe(true);
  });

  it("refuses anything but text", () => {
    expect(headerSearchTextSchema.safeParse(42).success).toBe(false);
  });
});
