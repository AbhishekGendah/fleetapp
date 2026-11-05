import { SECONDS_PER_HOUR } from "@fleetapp/core";

/**
 * How long a reset link works. Its own module, with nothing server-only in
 * it, because the "forgot password" page in the browser words it too.
 */
export const RESET_LINK_LIFETIME_SECONDS = SECONDS_PER_HOUR;
export const RESET_LINK_LIFETIME_WORDS = "1 hour";

/**
 * At most this many reset emails per login an hour (review G6-1), so a
 * login's inbox can't be flooded. Past it the page says the same as always
 * (never which emails have logins), but nothing more is sent.
 */
export const RESET_EMAILS_PER_HOUR = 3;
