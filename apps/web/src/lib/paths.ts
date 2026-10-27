/** The Operator app's own pages that other code sends people to. */
export const HOME_PATH = "/";
export const SIGN_IN_PATH = "/sign-in";
export const SET_UP_AUTHENTICATOR_PATH = "/set-up-authenticator";
export const SUSPENDED_PATH = "/suspended";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";

/** Joins a page onto the app's address, whether or not that ends in a slash. */
export function absoluteUrl(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, "")}${path}`;
}
