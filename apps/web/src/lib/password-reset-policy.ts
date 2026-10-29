import { SECONDS_PER_HOUR } from "@fleetapp/core";

/**
 * How long a reset link works. Its own module, with nothing server-only in
 * it, because the "forgot password" page in the browser words it too.
 */
export const RESET_LINK_LIFETIME_SECONDS = SECONDS_PER_HOUR;
export const RESET_LINK_LIFETIME_WORDS = "1 hour";
