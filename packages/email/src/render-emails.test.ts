import { privacyNoticeFor } from "@fleetapp/core";
import { describe, expect, it } from "vitest";

import {
  renderBillingDocumentEmail,
  renderDocumentCopyEmail,
  renderNewDeviceSignInEmail,
  renderOperatorInviteEmail,
  renderPasswordResetEmail,
  renderRenterDetailsLinkEmail,
  renderRenterDetailsSentBackEmail,
  renderRenterLinkCodeEmail,
  renderRenterPaymentsLinkEmail,
  renderRenterPrivacyNoticeEmail,
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

  it("never say reply when the business has no email for replies (review G7-4)", async () => {
    const withoutEmail = {
      to: "sam@example.test",
      renterName: "Sam",
      operatorName: "Sunny Rentals",
      linkUrl: "https://app.example.test/r/a-secret-token",
      validUntil: "Friday 6 November",
    };
    const silent = await renderRenterDetailsLinkEmail(withoutEmail);
    const answerable = await renderRenterDetailsLinkEmail({
      ...withoutEmail,
      replyTo: "office@sunny.test",
    });

    expect(silent.replyTo).toBeUndefined();
    expect(silent.text).not.toMatch(/reply/i);
    expect(silent.text).toContain("contact Sunny Rentals");
    expect(answerable.text).toContain("reply to let Sunny Rentals know");
  });

  it("send the privacy notice to a Renter added at the counter, from the business", async () => {
    const message = await renderRenterPrivacyNoticeEmail({
      to: "sam@example.test",
      replyTo: "office@sunny.test",
      renterName: "Sam",
      operatorName: "Sunny Rentals",
      notice: privacyNoticeFor(
        {
          name: "Sunny Rentals",
          email: "office@sunny.test",
          phone: null,
          privacyPolicyUrl: "https://sunny.example.com.au/privacy",
        },
        "TheApp",
        "counter",
      ),
    });

    expect(message).toMatchObject({
      fromName: "Sunny Rentals",
      subject: "How Sunny Rentals looks after your information",
    });
    expect(message.text).toContain("Sunny Rentals collects your details");
    expect(message.text).toContain("Postmark");
    expect(message.html).toContain("https://sunny.example.com.au/privacy");
  });

  it("puts the code in the body, never the subject", async () => {
    const message = await renderRenterLinkCodeEmail({
      to: "sam@example.test",
      operatorName: "Sunny Rentals",
      code: "042917",
      validFor: "10 minutes",
      purposeWords: "fill in your details",
    });
    expect(message.subject).not.toContain("042917");
    expect(message.text).toContain("042917");
  });

  it("says what the link is for (review G7-3)", async () => {
    const message = await renderRenterLinkCodeEmail({
      to: "sam@example.test",
      operatorName: "Sunny Rentals",
      code: "042917",
      validFor: "10 minutes",
      purposeWords: "sign your rental contract",
    });
    expect(message.text).toContain(
      "Type this code to sign your rental contract with Sunny Rentals",
    );
    expect(message.text).not.toContain("details form");
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

  it("sends the payments link from the business, saying details go on Stripe's page", async () => {
    const message = await renderRenterPaymentsLinkEmail({
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
      subject: expect.stringMatching(/payments/),
    });
    expect(message.text).toContain("https://app.example.test/r/a-secret");
    expect(message.text).toContain("Stripe");
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

  it("words a return report's copy as the car returned", async () => {
    const toBusiness = await renderDocumentCopyEmail({
      kind: "return_report",
      audience: "operator",
      to: "office@example.test",
      renterName: "Sam",
      operatorName: "Sam's Cars Pty Ltd",
      rentalSummary: "1ABC234 Toyota Corolla",
      at: "29 Jun 2027, 6:40 pm AWST",
      attachment: PDF,
    });

    expect(toBusiness.subject).toMatch(/^Car returned: Sam/);
    expect(toBusiness.text).toContain("was returned on 29 Jun 2027, 6:40 pm AWST");
  });

  it("words a business's handover copy as its driver receiving the car for it", async () => {
    const business = {
      kind: "handover_report" as const,
      renterName: "Dana",
      operatorName: "Sam's Cars Pty Ltd",
      rentalSummary: "1BRT482 Toyota Camry",
      at: "12 Oct 2026, 9:45 am AWST",
      attachment: PDF,
      forBusiness: { driverName: "Sam Lee", businessName: "Acme Rideshare Pty Ltd" },
    };
    const toContact = await renderDocumentCopyEmail({
      ...business,
      audience: "renter",
      to: "dana@acme.example.test",
    });
    const toOperator = await renderDocumentCopyEmail({
      ...business,
      audience: "operator",
      to: "office@example.test",
    });

    expect(toContact.text).toContain("Hi Dana,");
    expect(toContact.text).toContain(
      "Sam Lee received 1BRT482 Toyota Camry from Sam's Cars Pty Ltd for Acme Rideshare Pty Ltd.",
    );
    expect(toContact.text).not.toContain("The report you accepted");
    expect(toOperator.subject).toBe(
      "Car handed over: Acme Rideshare Pty Ltd, 1BRT482 Toyota Camry",
    );
    expect(toOperator.text).toContain(
      "Sam Lee accepted 1BRT482 Toyota Camry for Acme Rideshare Pty Ltd",
    );
  });

  it("words the driver's own copy to them, as the one who had the car for the business", async () => {
    const forDriver = {
      audience: "driver" as const,
      to: "sam.lee@example.test",
      renterName: "Dana",
      operatorName: "Sam's Cars Pty Ltd",
      rentalSummary: "1BRT482 Toyota Camry",
      at: "12 Oct 2026, 9:45 am AWST",
      attachment: PDF,
      replyTo: "hello@samscars.test",
      forBusiness: { driverName: "Sam Lee", businessName: "Acme Rideshare Pty Ltd" },
    };

    const [handover, returned, swapped] = await Promise.all(
      (["handover_report", "return_report", "swap_form"] as const).map((kind) =>
        renderDocumentCopyEmail({ ...forDriver, kind }),
      ),
    );

    expect(handover).toMatchObject({
      fromName: "Sam's Cars Pty Ltd",
      replyTo: "hello@samscars.test",
      subject: "Your car handover report from Sam's Cars Pty Ltd",
      attachments: [PDF],
    });
    expect(handover!.text).toContain("Hi Sam Lee,");
    expect(handover!.text).not.toContain("Dana");
    expect(handover!.text).toContain(
      "You received 1BRT482 Toyota Camry from Sam's Cars Pty Ltd for Acme Rideshare Pty Ltd. The report you accepted",
    );
    expect(returned!.text).toContain(
      "You returned 1BRT482 Toyota Camry to Sam's Cars Pty Ltd for Acme Rideshare Pty Ltd.",
    );
    expect(swapped!.text).toContain(
      "You swapped cars with Sam's Cars Pty Ltd for Acme Rideshare Pty Ltd: you now have 1BRT482 Toyota Camry.",
    );
  });

  it("names the business, and who signed for it, on a business's signed contract", async () => {
    const signed = {
      kind: "contract" as const,
      renterName: "Dana Wells",
      operatorName: "Sam's Cars Pty Ltd",
      rentalSummary: "1BRT482 Toyota Camry, from 1 June 2027",
      at: "8 Nov 2026, 10:00 am AWST",
      attachment: PDF,
      forBusiness: { driverName: "Dana Wells", businessName: "Acme Rideshare Pty Ltd" },
    };

    const [toSigner, toOffice] = await Promise.all(
      (["renter", "operator"] as const).map((audience) =>
        renderDocumentCopyEmail({ ...signed, audience, to: `${audience}@example.test` }),
      ),
    );

    expect(toOffice!.subject).toBe(
      "Contract signed: Acme Rideshare Pty Ltd, 1BRT482 Toyota Camry, from 1 June 2027",
    );
    expect(toOffice!.text).toContain("Dana Wells signed Acme Rideshare Pty Ltd's contract");
    expect(toSigner!.text).toContain("Hi Dana Wells,");
    expect(toSigner!.text).toContain("the rental contract for Acme Rideshare Pty Ltd");
  });

  it("sends an invoice from the business with its number, amount and PDF", async () => {
    const PDF_FILE = {
      fileName: "INV-1001.pdf",
      contentType: "application/pdf",
      content: new Uint8Array([1]),
    };
    const message = await renderBillingDocumentEmail({
      to: "sam@example.test",
      replyTo: "hello@samscars.test",
      title: "Tax invoice",
      numberText: "INV-1001",
      renterName: "Sam",
      operatorName: "Sam's Cars Pty Ltd",
      rentalSummary: "1ABC234 Toyota Corolla",
      amountLine: "Total $350.00, including GST of $31.82",
      attachment: PDF_FILE,
    });

    expect(message).toMatchObject({
      subject: "Tax invoice INV-1001 from Sam's Cars Pty Ltd",
      fromName: "Sam's Cars Pty Ltd",
      attachments: [PDF_FILE],
    });
    expect(message.text).toContain("Total $350.00, including GST of $31.82");
  });

  it("states a one-off charge, its GST, the debit date, the account's last digits and the contact", async () => {
    const message = await renderBillingDocumentEmail({
      to: "sam@example.test",
      title: "Tax invoice",
      numberText: "INV-1002",
      renterName: "Sam",
      operatorName: "Sam's Cars Pty Ltd",
      rentalSummary: "1ABC234 Toyota Corolla",
      amountLine: "Total $120.00, including GST of $10.91.",
      chargeLines: ["Cleaning (Interior cleaning): $120.00, including GST of $10.91."],
      debitLine: "It will be debited from your account ending 3456 on Sun 15 Nov 2026.",
      contactLine: "Questions about it? Contact Sam's Cars Pty Ltd on 08 9000 0000 before then.",
      attachment: {
        fileName: "INV-1002.pdf",
        contentType: "application/pdf",
        content: new Uint8Array([1]),
      },
    });

    expect(message.text).toContain(
      "Cleaning (Interior cleaning): $120.00, including GST of $10.91.",
    );
    expect(message.text).toContain("1ABC234 Toyota Corolla");
    expect(message.text).toContain(
      "It will be debited from your account ending 3456 on Sun 15 Nov 2026.",
    );
    expect(message.text).toContain("Contact Sam's Cars Pty Ltd on 08 9000 0000");
  });

  it("greets a business's contact and names the business the invoice is to", async () => {
    const message = await renderBillingDocumentEmail({
      to: "dana@acme.test",
      title: "Tax invoice",
      numberText: "INV-1067",
      renterName: "Dana Wells",
      businessName: "Acme Rideshare Pty Ltd",
      operatorName: "Sam's Cars Pty Ltd",
      rentalSummary: "1BRT482 Toyota Camry",
      amountLine: "Total $380.00, including GST of $34.55",
      attachment: {
        fileName: "INV-1067.pdf",
        contentType: "application/pdf",
        content: new Uint8Array([1]),
      },
    });

    expect(message.text).toContain("Hi Dana Wells,");
    expect(message.text).toContain(
      "The tax invoice from Sam's Cars Pty Ltd to Acme Rideshare Pty Ltd for 1BRT482 Toyota Camry is attached.",
    );
  });
});
