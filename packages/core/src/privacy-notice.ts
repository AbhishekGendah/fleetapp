/**
 * The collection notice a Renter is given (APP 5): who collects their
 * details and why, who else sees them (some overseas, APP 8), and how to
 * reach the business. One wording, shown on every Renter page and emailed to
 * a Renter added at the counter, so they never drift apart. To be checked by
 * the lawyer before real Renters get it (docs/launch-checklist.md).
 */

/** Where the notice is shown: each adds what that page itself collects. */
export const PRIVACY_NOTICE_PLACES = ["details", "signing", "payments", "counter"] as const;
export type PrivacyNoticePlace = (typeof PRIVACY_NOTICE_PLACES)[number];

/** The services the app uses that see a Renter's details, and what each sees. */
export const RENTER_DATA_SERVICES = [
  "Stripe (payments, in Australia and the USA) sees your name, email and payment details",
  "Postmark (emails, in the USA) sees your name, email address and what is emailed to you",
  "Amazon Web Services (file storage, in Sydney) keeps your documents and photos",
  "Google (address search, in the USA) sees what you type in an address box",
] as const;

export interface PrivacyNoticeBusiness {
  name: string;
  email: string | null;
  phone: string | null;
  privacyPolicyUrl: string | null;
}

export interface PrivacyNotice {
  title: string;
  paragraphs: string[];
  services: readonly string[];
  /** How to reach the business, already worded; null if no way is on file. */
  contact: string | null;
  /** The business's privacy policy, if it has given its address. */
  policyUrl: string | null;
  policyText: string;
}

const PLACE_PARAGRAPHS: Readonly<Record<PrivacyNoticePlace, (name: string) => string | null>> = {
  details: () => null,
  counter: () => null,
  signing: () =>
    "When you sign, your internet address, your phone or browser, and your signature are kept for good with the signed document, as proof of who signed and when.",
  payments: (name) =>
    `To set up your payments, your name and email go to Stripe. Your bank or card details go straight to Stripe: ${name} never sees or keeps them.`,
};

function contactText(business: PrivacyNoticeBusiness): string | null {
  const ways = [business.email, business.phone].filter((way): way is string => Boolean(way));
  return ways.length > 0 ? `Contact ${business.name}: ${ways.join(", ")}.` : null;
}

export function privacyNoticeFor(
  business: PrivacyNoticeBusiness,
  productName: string,
  place: PrivacyNoticePlace,
): PrivacyNotice {
  const { name } = business;
  const placeParagraph = PLACE_PARAGRAPHS[place](name);
  return {
    title: "About your information",
    paragraphs: [
      `${name} collects your details to rent you a car, to deal with tolls, fines and damage, and to contact you. Without them, ${name} may not be able to rent to you.`,
      `They are seen by ${name} and by ${productName}, the system ${name} uses. When the law or a claim needs it, ${name} may also pass them to its insurers, debt collectors, the police, or government agencies for fines and tolls.`,
      `Emails ${name} sends you carry your signed documents and the car's handover and return reports, with their photos.`,
      ...(placeParagraph ? [placeParagraph] : []),
      `${productName} uses these services, some of them overseas:`,
    ],
    services: RENTER_DATA_SERVICES,
    contact: contactText(business),
    policyUrl: business.privacyPolicyUrl,
    policyText: business.privacyPolicyUrl
      ? `${name}'s privacy policy says how to see or correct what they hold about you, and how to complain.`
      : `Ask ${name} for its privacy policy: it says how to see or correct what they hold about you, and how to complain.`,
  };
}
