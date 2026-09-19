import { z } from "zod";

const runtimeEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (non-owner app role connection string)"),
});

export const dbEnv = runtimeEnvSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
});
