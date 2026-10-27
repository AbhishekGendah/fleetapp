/**
 * How long a reset link works. Its own module, with nothing server-only in
 * it, because the "forgot password" page in the browser words it too.
 */
export const RESET_LINK_LIFETIME_SECONDS = 60 * 60;
export const RESET_LINK_LIFETIME_WORDS = "1 hour";
