import { describe, expect, it } from "vitest";

import { getGreeting } from "./greeting";

describe("greeting an Operator", () => {
  it("uses the Operator's clock, not the server's", () => {
    // 01:30 UTC is 9:30 am in Perth and 12:30 pm in Sydney (daylight saving).
    const moment = new Date("2026-10-27T01:30:00Z");

    expect(getGreeting(moment, "Australia/Perth")).toBe("Good morning");
    expect(getGreeting(moment, "Australia/Sydney")).toBe("Good afternoon");
  });

  it("turns to evening at 5 pm and back to morning at midnight", () => {
    expect(getGreeting(new Date("2026-10-27T09:00:00Z"), "Australia/Perth")).toBe("Good evening");
    expect(getGreeting(new Date("2026-10-27T16:00:00Z"), "Australia/Perth")).toBe("Good morning");
  });
});
