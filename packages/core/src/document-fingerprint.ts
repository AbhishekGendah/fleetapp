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
