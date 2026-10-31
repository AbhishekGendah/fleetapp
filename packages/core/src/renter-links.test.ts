import { describe, expect, it } from "vitest";

import { generateLinkCode, hashLinkCode, maskEmail, typedLinkCode } from "./renter-links";

describe("one-time link codes", () => {
  it("are always 6 digits", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateLinkCode()).toMatch(/^\d{6}$/);
    }
  });

  it("match only on their own link", () => {
    expect(hashLinkCode("link-a", "123456")).toBe(hashLinkCode("link-a", "123456"));
    expect(hashLinkCode("link-a", "123456")).not.toBe(hashLinkCode("link-b", "123456"));
  });

  it("are read from what is typed, spaces and all", () => {
    expect(typedLinkCode(" 123 456 ")).toBe("123456");
    expect(typedLinkCode("1234567")).toBe("123456");
  });
});

describe("a masked email", () => {
  it("shows the first letter and the domain only", () => {
    expect(maskEmail("sam@gmail.com")).toBe("s•••@gmail.com");
    expect(maskEmail("@odd")).toBe("your email");
  });
});
