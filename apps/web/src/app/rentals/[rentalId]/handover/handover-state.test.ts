import { describe, expect, it } from "vitest";

import { startHandoverRefusalMessage } from "./handover-state";

describe("why a handover can't start", () => {
  it("says to name a business's driver first, rather than going back with no word (second review)", () => {
    expect(startHandoverRefusalMessage("driver_not_named")).toBe(
      "Name the driver first, then start the handover.",
    );
  });

  it("has words for a rental no longer booked, and one not found", () => {
    expect(startHandoverRefusalMessage("not_booked")).toMatch(/^Only a booked rental/);
    expect(startHandoverRefusalMessage("not_found")).toBe("This rental could not be found.");
  });
});
