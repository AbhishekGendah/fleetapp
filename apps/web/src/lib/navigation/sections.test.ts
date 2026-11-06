import { describe, expect, it } from "vitest";

import { currentSection } from "./sections";

describe("currentSection", () => {
  it.each([
    ["/", "home"],
    ["/rentals", "rentals"],
    ["/rentals/new", "rentals"],
    ["/rentals/abc-123", "rentals"],
    ["/rentals/calendar", "calendar"],
    ["/rentals/timeline", "calendar"],
    ["/cars", "cars"],
    ["/cars/insurance/xyz", "cars"],
    ["/renters/abc/review", "renters"],
    ["/settings", "settings"],
    ["/settings/payments", "settings"],
  ])("puts %s in %s", (pathname, section) => {
    expect(currentSection(pathname)).toBe(section);
  });

  it("does not match a section by its first letters alone", () => {
    expect(currentSection("/settings-x")).toBeNull();
    expect(currentSection("/rentals/calendarish")).toBe("rentals");
    expect(currentSection("/privacy-notice")).toBeNull();
  });
});
