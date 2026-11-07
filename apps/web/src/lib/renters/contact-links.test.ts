import { describe, expect, it } from "vitest";

import { callHref, emailHref, textHref } from "./contact-links";

describe("links to call, text or email a Renter", () => {
  it("takes a phone's digits only, keeping a leading +", () => {
    expect(callHref("0491 570 006")).toBe("tel:0491570006");
    expect(textHref("+61 491 570 006")).toBe("sms:+61491570006");
  });

  it("emails the address as kept", () => {
    expect(emailHref("sam.patel@example.com")).toBe("mailto:sam.patel@example.com");
  });
});
