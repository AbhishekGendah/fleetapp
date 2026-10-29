import { z } from "zod";

const MINIMUM_SECRET_LENGTH = 32;

/**
 * The settings each login system needs, checked the same way in both apps
 * and the first-Admin command.
 */
export const authEnvShape = {
  /**
   * Encrypts authenticator secrets and recovery codes, and signs session
   * tokens. Lost or changed, every login in that app has to enrol its
   * authenticator again. Each app has its own.
   */
  BETTER_AUTH_SECRET: z
    .string()
    .min(
      MINIMUM_SECRET_LENGTH,
      `BETTER_AUTH_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters`,
    ),
  /**
   * The name shown against the entry in an authenticator app. An env var, not
   * the brand file, so the admin app can add "Admin" to it (CLAUDE.md).
   */
  AUTH_ISSUER_NAME: z.string().min(1),
};
