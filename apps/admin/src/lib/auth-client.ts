"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The browser half of the login system. No base URL is set: the admin app
 * serves its own auth routes, so a relative path keeps this working on
 * localhost, on a preview deployment and in production without configuration.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
