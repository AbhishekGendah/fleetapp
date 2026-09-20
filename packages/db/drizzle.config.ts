import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

loadEnv();

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
if (!migrationUrl) {
  throw new Error(
    "DATABASE_MIGRATION_URL is required to run drizzle-kit (owner-role, DIRECT/unpooled connection string).",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: migrationUrl,
  },
  strict: true,
  verbose: true,
});
