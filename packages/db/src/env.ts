import { z } from "zod";

const runtimeEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (non-owner app role connection string)"),
});

type DbEnv = z.infer<typeof runtimeEnvSchema>;

/**
 * Validated when first asked for, not when this module loads: code that brings
 * its own connection string (the first-Admin command, the login system) must
 * be able to import the client without being handed the app role's. The apps
 * still fail fast, because each validates DATABASE_URL in its own startup env.
 */
export function getDbEnv(): DbEnv {
  return runtimeEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
  });
}
