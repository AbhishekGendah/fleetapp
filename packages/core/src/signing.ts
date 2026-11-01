import { z } from "zod";

import { MAXIMUM_LINE_LENGTH, REQUIRED_MESSAGE } from "./form-text";

/**
 * Signing a contract on the Renter's phone (docs/design/05), made to meet
 * the Electronic Transactions Act 1999 (s 10): the signer is identified (a
 * code sent to their email), shows their intention (they sign the text they
 * read), the method is reliable (each step is recorded), and they agree to
 * sign electronically (an explicit tick).
 */

/** The exact words the Renter ticks, kept with the evidence as shown. */
export const SIGNING_CONSENT_TEXT =
  "I agree to sign this contract electronically, and that my electronic signature counts the same as signing on paper.";

export const SIGNATURE_METHODS = ["drawn", "typed"] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

export const SIGNATURE_METHOD_LABELS: Readonly<Record<SignatureMethod, string>> = {
  drawn: "Drew their signature",
  typed: "Typed their full name",
};

/** The steps recorded for each signing, each with its time, internet address and browser. */
export const SIGNING_EVIDENCE_STEPS = ["code_verified", "contract_viewed", "signed"] as const;
export type SigningEvidenceStep = (typeof SIGNING_EVIDENCE_STEPS)[number];

export const SIGNING_EVIDENCE_STEP_LABELS: Readonly<Record<SigningEvidenceStep, string>> = {
  code_verified: "Typed the code emailed to them",
  contract_viewed: "Opened the contract",
  signed: "Agreed to sign electronically and signed",
};

/** How long a contract signing link lasts. */
export const SIGNING_LINK_DAYS = 7;

/** A drawn signature is a small PNG; anything bigger is not one. */
export const MAXIMUM_DRAWN_SIGNATURE_BYTES = 200_000;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The PNG of a drawn signature from the pad's data URL, or null if it is not a small PNG. */
export function decodeDrawnSignature(dataUrl: string): Uint8Array | null {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return null;
  }
  let binary: string;
  try {
    binary = atob(dataUrl.slice(PNG_DATA_URL_PREFIX.length));
  } catch (error) {
    if (error instanceof DOMException) {
      return null;
    }
    throw error;
  }
  if (binary.length > MAXIMUM_DRAWN_SIGNATURE_BYTES) {
    return null;
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) ? bytes : null;
}

/** Capitals, spaces and punctuation aside, the same name. */
function nameKey(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // "O'Brien" and "OBrien" are one name; a hyphen or space separates words.
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

/** A typed signature must be the full name on the contract, so it identifies the signer. */
export function isTypedNameMatching(typed: string, fullName: string): boolean {
  const key = nameKey(typed);
  return key !== "" && key === nameKey(fullName);
}

const TICKED = "on";
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const CONSENT_NEEDED_MESSAGE = "Tick the box to agree to sign electronically.";
const DETAILS_NEEDED_MESSAGE = "Check your details and tick the box, or contact the business.";
const DRAW_NEEDED_MESSAGE = "Draw your signature in the box.";
const NAME_MISMATCH_MESSAGE = "Type your full name exactly as it is on the contract.";

/**
 * What the Renter sends when they sign. `fullName` is the name on the
 * contract, for checking a typed signature. `contractFingerprint` is the
 * fingerprint of the text their page showed: if the contract has changed
 * since, signing is refused.
 */
export interface SignContractInput {
  areDetailsConfirmed: typeof TICKED;
  hasConsented: typeof TICKED;
  method: SignatureMethod;
  typedName: string;
  drawnSignature: string;
  contractFingerprint: string;
}

export function signContractInputSchema(
  fullName: string,
): z.ZodType<SignContractInput, Record<(typeof SIGN_CONTRACT_FIELDS)[number], string>> {
  return z
    .object({
      areDetailsConfirmed: z.literal(TICKED, DETAILS_NEEDED_MESSAGE),
      hasConsented: z.literal(TICKED, CONSENT_NEEDED_MESSAGE),
      method: z.enum(SIGNATURE_METHODS, REQUIRED_MESSAGE),
      typedName: z.string().trim().max(MAXIMUM_LINE_LENGTH),
      drawnSignature: z.string(),
      contractFingerprint: z.string().regex(FINGERPRINT_PATTERN),
    })
    .superRefine((input, context) => {
      if (input.method === "typed" && !isTypedNameMatching(input.typedName, fullName)) {
        context.addIssue({ code: "custom", path: ["typedName"], message: NAME_MISMATCH_MESSAGE });
      }
      if (input.method === "drawn" && decodeDrawnSignature(input.drawnSignature) === null) {
        context.addIssue({
          code: "custom",
          path: ["drawnSignature"],
          message: DRAW_NEEDED_MESSAGE,
        });
      }
    });
}
export const SIGN_CONTRACT_FIELDS = [
  "areDetailsConfirmed",
  "hasConsented",
  "method",
  "typedName",
  "drawnSignature",
  "contractFingerprint",
] as const;
