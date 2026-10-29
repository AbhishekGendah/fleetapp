import { createHash } from "node:crypto";

import { describeErrorForLog } from "@fleetapp/core";

/** Have I Been Pwned's range lookup: given 5 characters of a SHA-1, it lists matching hashes. */
const BREACH_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const HASH_PREFIX_LENGTH = 5;
/** Waited for at most this long: a slow answer must not hold up choosing a password. */
const LOOKUP_TIMEOUT_MS = 3000;

/** Whether a password is known to have leaked. */
export type PasswordBreachCheck = (password: string) => Promise<boolean>;

/**
 * Asks Have I Been Pwned whether a password has leaked, without sending it:
 * only the first 5 characters of its SHA-1 fingerprint leave the server, and
 * the match is made here. Padding hides how many matches came back.
 *
 * Used to warn, never to refuse: a leaked password may still be used once
 * the person has been told (Abhi's decision). If the service cannot be
 * reached the answer is "not known to have leaked", with a warning logged.
 */
export function createBreachedPasswordCheck(
  fetchImplementation: typeof fetch = fetch,
): PasswordBreachCheck {
  return async (password) => {
    const fingerprint = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = fingerprint.slice(0, HASH_PREFIX_LENGTH);
    const suffix = fingerprint.slice(HASH_PREFIX_LENGTH);
    try {
      const response = await fetchImplementation(`${BREACH_RANGE_URL}${prefix}`, {
        headers: { "Add-Padding": "true" },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`The breached-password lookup answered ${response.status}`);
      }
      return isSuffixListed(await response.text(), suffix);
    } catch (error) {
      console.warn("Could not check a password against known breaches", describeErrorForLog(error));
      return false;
    }
  };
}

/** Each line is "SUFFIX:COUNT". Padding lines have a count of 0. */
function isSuffixListed(rangeResponse: string, suffix: string): boolean {
  return rangeResponse.split(/\r?\n/).some((line) => {
    const [listedSuffix, count] = line.split(":");
    return listedSuffix?.trim().toUpperCase() === suffix && Number(count) > 0;
  });
}
