import { describe, expect, it } from "vitest";

import {
  renderDocumentCopyEmail,
  renderNewDeviceSignInEmail,
  renderOperatorInviteEmail,
  renderPasswordResetEmail,
  renderRenterDetailsLinkEmail,
  renderRenterDetailsSentBackEmail,
  renderRenterLinkCodeEmail,
  renderRenterSigningLinkEmail,
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
    expect(message.subject).not.toContain("042917");
    expect(message.text).toContain("042917");
  });
});

describe("the details sent back email", () => {
  it("carries the Operator's note, escaped, and no link", async () => {
    const message = await renderRenterDetailsSentBackEmail({
      to: "sam@example.test",
      operatorName: "Sunny Rentals",
      note: "The back photo is blurry <b>please</b> retake it",
      linkWorksUntil: "7 Nov 2026",
    });
    expect(message.fromName).toBe("Sunny Rentals");
    expect(message.text).toContain("The back photo is blurry");
    expect(message.html).not.toContain("<b>please</b>");
    expect(message.text).not.toContain("http");
  });
});

describe("who an email is from", () => {
  it("keeps the address and swaps the name, without quotes or line breaks", () => {
    expect(senderFor("Sender Name <no-reply@example.test>", 'Sam\'s "Cars"\nBcc: x')).toBe(
      '"Sam\'s CarsBcc: x" <no-reply@example.test>',
    );
    expect(senderFor("no-reply@example.test")).toBe("no-reply@example.test");
  });
});

describe("the contract emails", () => {
  const PDF = {
    fileName: "Contract.pdf",
    contentType: "application/pdf",
    content: new Uint8Array([1]),
  };

  it("sends the signing link from the business, with the link in both versions", async () => {
    const message = await renderRenterSigningLinkEmail({
      to: "sam@example.test",
      renterName: "Sam",
      operatorName: "Sam's Cars Pty Ltd",
      rentalSummary: "1ABC234 Toyota Corolla, from 1 June 2027",
      linkUrl: "https://app.example.test/r/a-secret",
      validUntil: "Friday 6 November",
      replyTo: "hello@samscars.test",
    });

    expect(message).toMatchObject({
      fromName: "Sam's Cars Pty Ltd",
      replyTo: "hello@samscars.test",
    });
    expect(message.text).toContain("https://app.example.test/r/a-secret");
  });

  it("attaches the signed contract: from the business to the Renter, and to the business", async () => {
    const shared = {
      renterName: "Sam",
      operatorName: "Sam's Cars Pty Ltd",
      rentalSummary: "1ABC234 Toyota Corolla, from 1 June 2027",
      kind: "contract" as const,
      at: "3 Nov 2026, 2:15 pm AWST",
      attachment: PDF,
    };
    const toRenter = await renderDocumentCopyEmail({
      ...shared,
      to: "sam@example.test",
      audience: "renter",
    });
    const toBusiness = await renderDocumentCopyEmail({
      ...shared,
      to: "hello@samscars.test",
      audience: "operator",
    });

    expect(toRenter).toMatchObject({ fromName: "Sam's Cars Pty Ltd", attachments: [PDF] });
    expect(toBusiness.fromName).toBeUndefined();
    expect(toBusiness.subject).toBe(
      "Contract signed: Sam, 1ABC234 Toyota Corolla, from 1 June 2027",
    );
    expect(toBusiness.attachments).toEqual([PDF]);
  });

  it("words a handover report's copy as the car handed over", async () => {
    const toRenter = await renderDocumentCopyEmail({
      kind: "handover_report",
      audience: "renter",
      to: "sam@example.test",
      renterName: "Sam",
      operatorName: "Sam's Cars Pty Ltd",
      rentalSummary: "1ABC234 Toyota Corolla, from 1 June 2027",
      at: "1 Jun 2027, 9:05 am AWST",
      attachment: PDF,
    });

    expect(toRenter.subject).toBe("Your car handover report from Sam's Cars Pty Ltd");
    expect(toRenter.text).toContain("The report you accepted");
  });
});
