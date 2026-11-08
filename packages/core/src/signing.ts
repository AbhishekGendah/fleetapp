import { z } from "zod";

import { MAXIMUM_LINE_LENGTH, REQUIRED_MESSAGE } from "./form-text";
import { DRAWN_SIGNATURE_LIMITS, isPictureWithin } from "./picture-size";

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

/**
 * The PNG of a drawn signature from the pad's data URL, or null if it is
 * not a small PNG of a sensible size.
 */
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
  const isPng = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  // A doctored PNG can claim huge dimensions in very few bytes (review G5-1).
  return isPng && isPictureWithin(bytes, DRAWN_SIGNATURE_LIMITS) ? bytes : null;
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
const SIGNER_NAME_MISMATCH_MESSAGE = "Type your full name exactly as you gave it above.";
const SIGNER_NAME_NEEDED_MESSAGE = "Enter your full name.";
const SIGNER_POSITION_NEEDED_MESSAGE = "Enter your position, e.g. Director or Fleet manager.";
const SIGNER_IS_BUSINESS_MESSAGE =
  "Enter your own full name, not the business's: you sign for it as yourself.";

/**
 * A business Renter signs through a person who says they may (decision 3):
 * they give their name and position and tick that they are authorised to
 * sign for the business, named by its legal name. Kept with the evidence.
 */
export interface SigningAuthority {
  legalName: string;
  /** What the business trades as, if anything: no more a person's name than its legal name. */
  tradingName?: string | null;
}

/** The exact words a business's signer ticks, kept with the evidence as shown. */
export function authorisedToSignText(legalName: string): string {
  return `I am authorised to sign for ${legalName}.`;
}

function authorisedNeededMessage(legalName: string): string {
  return `Tick the box to say you are authorised to sign for ${legalName}.`;
}

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
  /** A business's signer only (none for a person): who signs, their position, and their tick. */
  signerName: string;
  signerPosition: string;
  isAuthorised: string;
}

type AuthorityField = "signerName" | "signerPosition" | "isAuthorised";
/** The signing form's values as sent: a person's form sends none of a business signer's fields. */
type SignContractValues = Record<
  Exclude<(typeof SIGN_CONTRACT_FIELDS)[number], AuthorityField>,
  string
> &
  Partial<Record<AuthorityField, string>>;

type SignFieldIssue = { path: [string]; message: string };

/** Whether the signer gave the business's own name (legal or trading) as theirs. */
function isBusinessName(signerName: string, authority: SigningAuthority): boolean {
  return [authority.legalName, authority.tradingName ?? ""].some((businessName) =>
    isTypedNameMatching(signerName, businessName),
  );
}

/** Why the signer's name won't do: none given, or the business's own; null when it will. */
function signerNameIssue(value: unknown, authority: SigningAuthority): string | null {
  const signerName = String(value ?? "").trim();
  if (signerName === "") {
    return SIGNER_NAME_NEEDED_MESSAGE;
  }
  return isBusinessName(signerName, authority) ? SIGNER_IS_BUSINESS_MESSAGE : null;
}

/**
 * What a business's signer still has to give: their own name (never the
 * business's), their position and the authority tick.
 */
function authorityIssues(
  input: Partial<Record<AuthorityField, unknown>>,
  authority: SigningAuthority,
): SignFieldIssue[] {
  const isBlank = (value: unknown) => String(value ?? "").trim() === "";
  const nameIssue = signerNameIssue(input.signerName, authority);
  return [
    ...(nameIssue ? [{ path: ["signerName"] as [string], message: nameIssue }] : []),
    ...(isBlank(input.signerPosition)
      ? [{ path: ["signerPosition"] as [string], message: SIGNER_POSITION_NEEDED_MESSAGE }]
      : []),
    ...(input.isAuthorised === TICKED
      ? []
      : [
          {
            path: ["isAuthorised"] as [string],
            message: authorisedNeededMessage(authority.legalName),
          },
        ]),
  ];
}

/**
 * The signing form's rules. A person's typed signature must be their full
 * name on the contract; a business's signer (`authority` given) types their
 * own name as they gave it, with their position and the authority tick.
 */
export function signContractInputSchema(
  fullName: string,
  authority?: SigningAuthority,
): z.ZodType<SignContractInput, SignContractValues> {
  return z
    .object({
      areDetailsConfirmed: z.literal(TICKED, DETAILS_NEEDED_MESSAGE),
      hasConsented: z.literal(TICKED, CONSENT_NEEDED_MESSAGE),
      method: z.enum(SIGNATURE_METHODS, REQUIRED_MESSAGE),
      typedName: z.string().trim().max(MAXIMUM_LINE_LENGTH),
      drawnSignature: z.string(),
      contractFingerprint: z.string().regex(FINGERPRINT_PATTERN),
      // A person's form has none of these: they read as empty.
      signerName: z.string().trim().max(MAXIMUM_LINE_LENGTH).default(""),
      signerPosition: z.string().trim().max(MAXIMUM_LINE_LENGTH).default(""),
      isAuthorised: z.string().default(""),
    })
    .superRefine(
      (input, context) => {
        const signerName = authority ? String(input.signerName ?? "") : fullName;
        if (
          input.method === "typed" &&
          !isTypedNameMatching(String(input.typedName ?? ""), signerName)
        ) {
          context.addIssue({
            code: "custom",
            path: ["typedName"],
            message: authority ? SIGNER_NAME_MISMATCH_MESSAGE : NAME_MISMATCH_MESSAGE,
          });
        }
        for (const issue of authority ? authorityIssues(input, authority) : []) {
          context.addIssue({ code: "custom", ...issue });
        }
        if (
          input.method === "drawn" &&
          decodeDrawnSignature(String(input.drawnSignature ?? "")) === null
        ) {
          context.addIssue({
            code: "custom",
            path: ["drawnSignature"],
            message: DRAW_NEEDED_MESSAGE,
          });
        }
      },
      // Checked even while the tick boxes are empty, so a wrong name shows as it is typed.
      // The input may then be only partly valid, hence the String() above.
      { when: () => true },
    );
}
export const SIGN_CONTRACT_FIELDS = [
  "areDetailsConfirmed",
  "hasConsented",
  "method",
  "typedName",
  "drawnSignature",
  "contractFingerprint",
  "signerName",
  "signerPosition",
  "isAuthorised",
] as const;

/** A Renter's signature on the business's phone (handover, return, swap): drawn or typed. */
export type RenterSignature =
  { method: "drawn"; drawnPng: Uint8Array } | { method: "typed"; typedName: string };

/** The signature fields a business-phone signing form sends, as typed. */
export interface RenterSignatureInput {
  method: string;
  typedName: string;
  drawnSignature: string;
}

/** The form fields that carry a signature on the business's phone. */
export const RENTER_SIGNATURE_FIELDS = ["method", "typedName", "drawnSignature"] as const;

/**
 * The Renter's signature from the form, or null if it isn't one: a drawing
 * that isn't a small PNG, or a typed name that isn't theirs. The same rules
 * as the Renter's own signing link (review G9-10).
 */
export function readRenterSignature(
  input: RenterSignatureInput,
  fullName: string,
): RenterSignature | null {
  if (input.method === "typed") {
    const typedName = input.typedName.trim();
    return isTypedNameMatching(typedName, fullName) ? { method: "typed", typedName } : null;
  }
  if (input.method !== "drawn") {
    return null;
  }
  const drawnPng = decodeDrawnSignature(input.drawnSignature);
  return drawnPng ? { method: "drawn", drawnPng } : null;
}

/** The ways to sign offered to a Renter, worded for the Renter. */
export const SIGNATURE_METHOD_CHOICES: readonly { method: SignatureMethod; label: string }[] = [
  { method: "drawn", label: "Draw my signature" },
  { method: "typed", label: "Type my full name" },
];

/** A drawn signature as a form would send it: for code that signs on a Renter's behalf in tests and demos. */
export function drawnSignatureInput(drawnSignature: string): RenterSignatureInput {
  return { method: "drawn", typedName: "", drawnSignature };
}
