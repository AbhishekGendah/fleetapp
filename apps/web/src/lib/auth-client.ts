"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The browser half of the login system. No base URL: the Operator app serves
 * its own auth routes, so a relative path works on localhost, on a preview
 * deployment and in production alike.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
