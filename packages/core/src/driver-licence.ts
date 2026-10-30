import { AUSTRALIAN_STATE_CODES } from "./postcodes";

/**
 * Australian driver licence numbers: digits in WA, QLD, NSW and VIC, letters
 * and digits in SA, TAS, NT and ACT, and never more than 10 characters.
 * Spaces and dashes people type in are dropped, letters are capitals.
 */
export const MAXIMUM_LICENCE_NUMBER_LENGTH = 10;
/** Overseas licences follow no one pattern; this holds every one seen in practice. */
export const MAXIMUM_OVERSEAS_LICENCE_NUMBER_LENGTH = 20;

export function normaliseLicenceNumber(
  typed: string,
  maximumLength: number = MAXIMUM_LICENCE_NUMBER_LENGTH,
): string {
  return typed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, maximumLength);
}

/** Where a licence was issued: an Australian state or territory, or overseas (with its country). */
export const LICENCE_ISSUERS = [...AUSTRALIAN_STATE_CODES, "overseas"] as const;
export type LicenceIssuer = (typeof LICENCE_ISSUERS)[number];
export const OVERSEAS_ISSUER = "overseas" satisfies LicenceIssuer;

export function licenceNumberMaximumLength(issuedIn: string): number {
  return issuedIn === OVERSEAS_ISSUER
    ? MAXIMUM_OVERSEAS_LICENCE_NUMBER_LENGTH
    : MAXIMUM_LICENCE_NUMBER_LENGTH;
}

/** The Australian classes, lightest first. C covers every car a rental fleet has. */
export const LICENCE_CLASSES = ["C", "LR", "MR", "HR", "HC", "MC"] as const;
export type LicenceClass = (typeof LICENCE_CLASSES)[number];

export const LICENCE_CLASS_LABELS: Readonly<Record<LicenceClass, string>> = {
  C: "C (car)",
  LR: "LR (light rigid)",
  MR: "MR (medium rigid)",
  HR: "HR (heavy rigid)",
  HC: "HC (heavy combination)",
  MC: "MC (multi-combination)",
};

/**
 * Full or provisional (P plates). Overseas is where a licence was issued, not
 * a type, so a licence cannot be both WA and overseas (decision 3 of
 * docs/plans/phase-2-step-3.md).
 */
export const LICENCE_TYPES = ["full", "provisional"] as const;
export type LicenceType = (typeof LICENCE_TYPES)[number];

export const LICENCE_TYPE_LABELS: Readonly<Record<LicenceType, string>> = {
  full: "Full",
  provisional: "Provisional (P plates)",
};

/** The two sides of a licence card, each kept as its own scan. */
export const LICENCE_SIDES = ["front", "back"] as const;
export type LicenceSide = (typeof LICENCE_SIDES)[number];

export const LICENCE_SIDE_LABELS: Readonly<Record<LicenceSide, string>> = {
  front: "Front",
  back: "Back",
};
