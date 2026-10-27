/**
 * Marks every admin page, so the admin site is never mistaken for an
 * Operator's. Its own module so browser-side pages can use it without
 * pulling in the server-only page frame.
 */
export const ADMIN_LABEL = "Admin";
