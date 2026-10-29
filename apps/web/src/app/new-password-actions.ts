"use server";

import { createBreachedPasswordCheck } from "@fleetapp/auth";
import { MAXIMUM_PASSWORD_LENGTH } from "@fleetapp/auth/login-policy";

const isPasswordBreached = createBreachedPasswordCheck();

/**
 * Whether a password someone is about to choose is known to have leaked, so
 * the page can warn them before they commit to it. It only ever answers yes
 * or no, which Have I Been Pwned tells anyone anyway, so it needs no sign-in:
 * the invite and reset pages are used before there is one.
 */
export async function isPasswordKnownToHaveLeakedAction(password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length > MAXIMUM_PASSWORD_LENGTH) {
    return false;
  }
  return isPasswordBreached(password);
}
