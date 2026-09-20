import { z } from "zod";

// Validated once at import time so a missing/invalid variable fails fast
// instead of surfacing as a confusing runtime error later.
const envSchema = z.object({
  ADMIN_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
});

export const env = envSchema.parse({
  ADMIN_URL: process.env.ADMIN_URL,
  DATABASE_URL: process.env.DATABASE_URL,
});
