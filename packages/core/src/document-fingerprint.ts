import { createHash } from "node:crypto";

/** A SHA-256 fingerprint is 64 hexadecimal characters. */
export const DOCUMENT_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The SHA-256 fingerprint of an issued document's PDF (rule 12): any change
 * to a single byte gives a different fingerprint, so a copy can be proved to
 * be the one issued.
 */
export function documentFingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** JSON with every object's keys in order, so the same content always gives the same text. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The fingerprint of a contract's filled-in text, whatever order its keys
 * come in: what the Renter was shown, so signing a changed contract is caught.
 */
export function contentFingerprint(content: unknown): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}
