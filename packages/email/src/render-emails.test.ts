import { describe, expect, it } from "vitest";

import {
  renderNewDeviceSignInEmail,
  renderOperatorInviteEmail,
  renderPasswordResetEmail,
  renderRenterDetailsLinkEmail,
  renderRenterLinkCodeEmail,
} from "./render-emails";
import { senderFor } from "./email-sender";

const ACCEPT_URL = "https://app.example.test/invite/a-secret-token";

describe("the Operator invite email", () => {
  it("carries the link in both the HTML and the plain-text version", async () => {
    const message = await renderOperatorInviteEmail({
      to: "user@example.test",
      inviteeName: "Sam",
      operatorName: "Sam's Cars Pty Ltd",
      acceptUrl: ACCEPT_URL,
    });

    expect(message.to).toBe("user@example.test");
    expect(message.subject).toContain("Sam's Cars Pty Ltd");
    expect(message.html).toContain(ACCEPT_URL);
    expect(message.text).toContain(ACCEPT_URL);
    expect(message.text).toContain("7 days");
  });

  it("escapes names, so an Operator name cannot inject markup", async () => {
    const message = await renderOperatorInviteEmail({
      to: "user@example.test",
      inviteeName: "Sam",
      operatorName: "<script>alert(1)</script>",
      acceptUrl: ACCEPT_URL,
    });

    expect(message.html).not.toContain("<script>");
  });
});

describe("the password reset email", () => {
  it("carries the reset link and says how long it works", async () => {
    const resetUrl = "https://app.example.test/reset-password?token=a-secret";
    const message = await renderPasswordResetEmail({
      to: "user@example.test",
      name: "Sam",
      resetUrl,
      validFor: "1 hour",
    });

    expect(message.html).toContain("https://app.example.test/reset-password?token=a-secret");
    expect(message.text).toContain(resetUrl);
    expect(message.text).toContain("1 hour");
  });
});

describe("the new-device email", () => {
  it("names the device and the time, and links to changing the password", async () => {
    const message = await renderNewDeviceSignInEmail({
      to: "user@example.test",
      name: "Sam",
      signedInAt: "27 Oct 2026, 2:15 pm",
      deviceDescription: "Chrome on Windows",
      resetPasswordUrl: "https://app.example.test/forgot-password",
    });

    expect(message.text).toContain("Chrome on Windows");
    expect(message.text).toContain("27 Oct 2026, 2:15 pm");
    expect(message.text).toContain("https://app.example.test/forgot-password");
  });
});

describe("Renter emails", () => {
  it("come from the Operator's business, reply to the Operator, and carry the link", async () => {
    const message = await renderRenterDetailsLinkEmail({
      to: "sam@example.test",
      renterName: "Sam",
      operatorName: "Sunny Rentals",
      replyTo: "office@sunny.test",
      linkUrl: "https://app.example.test/r/a-secret-token",
      validUntil: "Friday 6 November",
    });
    expect(message).toMatchObject({ fromName: "Sunny Rentals", replyTo: "office@sunny.test" });
    expect(message.text).toContain("https://app.example.test/r/a-secret-token");
    expect(message.html).toContain("Sunny Rentals");
  });

  it("put the code in the subject and the body", async () => {
    const message = await renderRenterLinkCodeEmail({
      to: "sam@example.test",
      operatorName: "Sunny Rentals",
      code: "042917",
      validFor: "10 minutes",
    });
    expect(message.subject).toContain("042917");
    expect(message.text).toContain("042917");
  });
});

describe("who an email is from", () => {
  it("keeps the address and swaps the name, without quotes or line breaks", () => {
    expect(senderFor("PintoFleet <no-reply@example.test>", 'Sam\'s "Cars"\nBcc: x')).toBe(
      '"Sam\'s CarsBcc: x" <no-reply@example.test>',
    );
    expect(senderFor("no-reply@example.test")).toBe("no-reply@example.test");
  });
});
