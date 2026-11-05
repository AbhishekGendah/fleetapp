import { describe, expect, it } from "vitest";

import {
  formTextValues,
  optionalLine,
  optionalWebAddress,
  requiredEmail,
  requiredLine,
} from "./form-text";

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

describe("a web address the business gives", () => {
  it("takes a full https address, and blank as none", () => {
    expect(optionalWebAddress.parse("https://coast.example.com.au/privacy")).toBe(
      "https://coast.example.com.au/privacy",
    );
    expect(optionalWebAddress.parse("  ")).toBeNull();
  });

  it("refuses anything that is not an https page on a real domain", () => {
    for (const address of [
      "http://coast.example.com.au/privacy",
      "javascript:alert(1)",
      "coast.example.com.au",
      "https://203.0.113.9/privacy",
      "https://localhost/privacy",
    ]) {
      expect(optionalWebAddress.safeParse(address).success, address).toBe(false);
    }
  });
});
