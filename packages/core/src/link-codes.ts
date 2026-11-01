import { createHash, randomInt } from "node:crypto";

import { LINK_CODE_DIGITS } from "./renter-links";

/** A one-time code: 6 digits, any of a million, leading zeros kept. */
export function generateLinkCode(): string {
  return String(randomInt(0, 10 ** LINK_CODE_DIGITS)).padStart(LINK_CODE_DIGITS, "0");
}

/**
 * The fingerprint a code is stored by, tied to its link so the same code on
 * another link never matches. A code lives 10 minutes and a link allows 10
 * wrong guesses in all, so a fast hash is enough.
 */
export function hashLinkCode(linkId: string, code: string): string {
  return createHash("sha256").update(`${linkId}:${code}`).digest("hex");
}
