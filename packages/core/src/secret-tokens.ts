import { createHash, randomBytes } from "node:crypto";

/**
 * 32 random bytes: far beyond guessing, so a fast hash is enough to store it
 * by. A slow password hash only earns its cost on secrets people choose.
 */
const SECRET_TOKEN_BYTES = 32;

/**
 * A secret for a link: invites now, Renter links later.
 *
 * URL-safe, so it can sit in a link without escaping. Shown to its recipient
 * once, in the link, and never stored: store `hashSecretToken(token)` instead.
 */
export function generateSecretToken(): string {
  return randomBytes(SECRET_TOKEN_BYTES).toString("base64url");
}

/**
 * The fingerprint stored in place of a secret token. Looking a link up means
 * hashing what arrived and searching for the hash.
 */
export function hashSecretToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
