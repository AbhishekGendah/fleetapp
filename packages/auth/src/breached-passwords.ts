import { describeErrorForLog } from "@fleetapp/core";
import { isPasswordCompromised } from "better-auth/plugins/haveibeenpwned";

/** Waited for at most this long: a slow answer must not hold up choosing a password. */
const LOOKUP_TIMEOUT_MS = 3000;

/** Whether a password is known to have leaked. */
export type PasswordBreachCheck = (password: string) => Promise<boolean>;

function timeoutAfter(milliseconds: number): { promise: Promise<never>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("The breached-password lookup timed out")),
      milliseconds,
    );
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Asks Have I Been Pwned whether a password has leaked, through Better
 * Auth's own check: only the first 5 characters of its SHA-1 fingerprint
 * leave the server, the match is made here, and padding hides how many
 * matches came back.
 *
 * Better Auth's plugin version refuses the password, and refuses every
 * password while the service is down. We only warn (Abhi's decision): a
 * leaked password may still be used once the person has been told. So the
 * check is used on its own, and if the service cannot be reached the answer
 * is "not known to have leaked", with a warning logged.
 */
export function createBreachedPasswordCheck(
  lookup: PasswordBreachCheck = isPasswordCompromised,
): PasswordBreachCheck {
  return async (password) => {
    const timeout = timeoutAfter(LOOKUP_TIMEOUT_MS);
    try {
      return await Promise.race([lookup(password), timeout.promise]);
    } catch (error) {
      console.warn("Could not check a password against known breaches", describeErrorForLog(error));
      return false;
    } finally {
      timeout.cancel();
    }
  };
}
