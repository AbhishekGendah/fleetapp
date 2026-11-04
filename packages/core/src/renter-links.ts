/**
 * The rules for links a Renter opens without logging in (rule 26): each is
 * for one purpose, expires, can be cancelled, and asks for a one-time code
 * on a phone it has not seen before.
 */

/**
 * What a link is for. "set_up_payments" is a rental's direct debit and bond
 * (Phase 4, slice 4). Booking view comes later.
 */
export const RENTER_LINK_PURPOSES = [
  "details_form",
  "sign_contract",
  "sign_change",
  "set_up_payments",
] as const;
export type RenterLinkPurpose = (typeof RENTER_LINK_PURPOSES)[number];

/** How long a details form link lasts: an Operator setting (rule 27). */
export const DEFAULT_RENTER_LINK_DAYS = 7;
export const MINIMUM_RENTER_LINK_DAYS = 1;
export const MAXIMUM_RENTER_LINK_DAYS = 30;

export const LINK_CODE_DIGITS = 6;
export const LINK_CODE_VALID_MINUTES = 10;
/**
 * Wrong codes allowed over the link's whole life before it locks and the
 * Operator must send a new one. Counted per link, not per code, so asking for
 * a new code never buys more guesses.
 */
export const MAXIMUM_WRONG_LINK_CODES = 10;
/** Codes that can be emailed for one link in an hour, so a link cannot flood an inbox. */
export const MAXIMUM_LINK_CODES_PER_HOUR = 3;

/** "s•••@gmail.com": enough for the Renter to know where to look, too little to learn the address. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) {
    return "your email";
  }
  return `${email[0]}•••${email.slice(at)}`;
}

/** Typed codes may come with spaces ("123 456"); only the digits count. */
export function typedLinkCode(typed: string): string {
  return typed.replace(/\D/g, "").slice(0, LINK_CODE_DIGITS);
}

/** Address searches one link may make, so a link cannot run up the Google bill. */
export const MAXIMUM_LINK_ADDRESS_SEARCHES = 50;

/** What a Renter sent through their link: waiting for the Operator, then approved or sent back. */
export const RENTER_SUBMISSION_STATUSES = ["waiting", "approved", "sent_back"] as const;
export type RenterSubmissionStatus = (typeof RENTER_SUBMISSION_STATUSES)[number];

/**
 * How often one link may open Stripe's page, or upload a licence photo, in
 * an hour (review G6-6): far more than a Renter needs, so only a flood or
 * a script is stopped.
 */
export const LINK_HOURLY_LIMITS = { stripePages: 10, licencePhotos: 20 } as const;
export type LinkLimitedAction = keyof typeof LINK_HOURLY_LIMITS;
