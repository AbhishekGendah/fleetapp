import { createHash, timingSafeEqual } from "node:crypto";

/** How Vercel's scheduler proves a call is its own: the shared secret as a bearer token. */
const BEARER_PREFIX = "Bearer ";

function fingerprint(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

/**
 * Whether a scheduled-job request carries the secret only Vercel and the app
 * know. Compared in constant time, so the answer's timing gives nothing away.
 */
export function isScheduledJobRequest(authorization: string | null, cronSecret: string): boolean {
  if (!authorization?.startsWith(BEARER_PREFIX)) {
    return false;
  }
  return timingSafeEqual(
    fingerprint(authorization.slice(BEARER_PREFIX.length)),
    fingerprint(cronSecret),
  );
}
