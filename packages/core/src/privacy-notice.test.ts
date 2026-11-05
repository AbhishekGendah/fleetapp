import { describe, expect, it } from "vitest";

import { privacyNoticeFor, type PrivacyNoticeBusiness } from "./privacy-notice";

const BUSINESS: PrivacyNoticeBusiness = {
  name: "Coast Cars",
  email: "hello@coast.example",
  phone: "08 9000 0000",
  privacyPolicyUrl: "https://coast.example/privacy",
};

describe("the Renter's privacy notice", () => {
  it("names the business, the app, the overseas services and how to reach the business", () => {
    const notice = privacyNoticeFor(BUSINESS, "TheApp", "details");
    const text = [...notice.paragraphs, ...notice.services].join(" ");

    expect(text).toContain("Coast Cars collects your details");
    expect(text).toContain("TheApp");
    for (const service of ["Stripe", "Postmark", "Amazon Web Services", "Google"]) {
      expect(text).toContain(service);
    }
    expect(text).toMatch(/insurers, debt collectors/);
    expect(text).toMatch(/signed documents .* photos/);
    expect(notice.contact).toBe("Contact Coast Cars: hello@coast.example, 08 9000 0000.");
    expect(notice.policyUrl).toBe(BUSINESS.privacyPolicyUrl);
  });

  it("says what signing keeps, and what payments send to Stripe, only where they happen", () => {
    const signing = privacyNoticeFor(BUSINESS, "TheApp", "signing").paragraphs.join(" ");
    const payments = privacyNoticeFor(BUSINESS, "TheApp", "payments").paragraphs.join(" ");
    const details = privacyNoticeFor(BUSINESS, "TheApp", "details").paragraphs.join(" ");

    expect(signing).toMatch(/internet address, your phone or browser, and your signature/);
    expect(payments).toMatch(/name and email go to Stripe/);
    expect(details).not.toMatch(/internet address|go to Stripe/);
  });

  it("asks for the policy when the business has no link, and leaves out contact it has not given", () => {
    const notice = privacyNoticeFor(
      { name: "Coast Cars", email: null, phone: null, privacyPolicyUrl: null },
      "TheApp",
      "counter",
    );

    expect(notice.contact).toBeNull();
    expect(notice.policyUrl).toBeNull();
    expect(notice.policyText).toMatch(/^Ask Coast Cars for its privacy policy/);
  });
});
