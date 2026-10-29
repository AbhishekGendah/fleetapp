import { describe, expect, it } from "vitest";

import { formTextValues, optionalLine, requiredEmail, requiredLine } from "./form-text";

describe("form text rules", () => {
  it("trims, refuses blanks where required, and keeps to one line", () => {
    expect(requiredLine.parse("  Test Fleet ")).toBe("Test Fleet");
    expect(requiredLine.safeParse("   ").success).toBe(false);
    expect(requiredLine.safeParse("Test\nFleet").success).toBe(false);
    expect(optionalLine.parse("")).toBeNull();
  });

  it("lower-cases an email address", () => {
    expect(requiredEmail.parse(" Jo@Example.TEST ")).toBe("jo@example.test");
    expect(requiredEmail.safeParse("not-an-email").success).toBe(false);
  });

  it("reads only the named fields, blank when missing", () => {
    const formData = new FormData();
    formData.set("legalName", "Test Fleet");
    formData.set("$ACTION_ID", "ignored");

    expect(formTextValues(formData, ["legalName", "email"])).toEqual({
      legalName: "Test Fleet",
      email: "",
    });
  });
});
