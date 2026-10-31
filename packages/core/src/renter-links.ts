import { createHash, randomInt } from "node:crypto";

/**
 * The rules for links a Renter opens without logging in (rule 26): each is
 * for one purpose, expires, can be cancelled, and asks for a one-time code
 * on a phone it has not seen before.
 */

/** What a link is for. Contract signing, booking view and payments come later. */
export const RENTER_LINK_PURPOSES = ["details_form"] as const;
export type RenterLinkPurpose = (typeof RENTER_LINK_PURPOSES)[number];

/** How long a details form link lasts: an Operator setting (rule 27). */
export const DEFAULT_RENTER_LINK_DAYS = 7;
export const MINIMUM_RENTER_LINK_DAYS = 1;
export const MAXIMUM_RENTER_LINK_DAYS = 30;

export const LINK_CODE_DIGITS = 6;
export const LINK_CODE_VALID_MINUTES = 10;
/** Wrong codes allowed before the link locks and the Operator must send a new one. */
export const MAXIMUM_LINK_CODE_TRIES = 5;
/** Codes that can be emailed for one link in an hour, so a link cannot flood an inbox. */
export const MAXIMUM_LINK_CODES_PER_HOUR = 3;

/** A one-time code: 6 digits, any of a million, leading zeros kept. */
export function generateLinkCode(): string {
  return String(randomInt(0, 10 ** LINK_CODE_DIGITS)).padStart(LINK_CODE_DIGITS, "0");
}

/**
 * The fingerprint a code is stored by, tied to its link so the same code on
 * another link never matches. A code lives 10 minutes and allows 5 tries,
 * so a fast hash is enough.
 */
export function hashLinkCode(linkId: string, code: string): string {
  return createHash("sha256").update(`${linkId}:${code}`).digest("hex");
}

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
