import { describe, expect, it } from "vitest";

import { accountInitial } from "./account-initial";

describe("accountInitial", () => {
  it("takes the first letter of the name, as a capital", () => {
    expect(accountInitial({ fullName: "sam patel", email: "x@example.test" })).toBe("S");
  });

  it("falls back to the email when the name is blank", () => {
    expect(accountInitial({ fullName: "  ", email: "jo@example.test" })).toBe("J");
  });
});
