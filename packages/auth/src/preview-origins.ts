import { z } from "zod";

/** Vercel's name for a branch preview build (its VERCEL_ENV). */
const VERCEL_PREVIEW_ENV = "preview";
/** Only Vercel's own preview addresses are ever trusted, never a custom one. */
const VERCEL_PREVIEW_HOST_SUFFIX = ".vercel.app";
const DEVELOPMENT_STAGE = "development";

/**
 * Vercel sets these on every build by itself (its "system" settings); they
 * are never typed in. Optional because they are absent off Vercel.
 */
export const vercelEnvShape = {
  /** "production", "preview" or "development". */
  VERCEL_ENV: z.string().optional(),
  /** This deployment's own address, without https:// (e.g. app-abc123.vercel.app). */
  VERCEL_URL: z.string().optional(),
  /** The branch's lasting preview address, without https://. */
  VERCEL_BRANCH_URL: z.string().optional(),
};

export interface PreviewOriginInput {
  appStage?: string | undefined;
  vercelEnv?: string | undefined;
  deploymentHosts: readonly (string | undefined)[];
}

/** A bare host name only: letters, digits, dots and dashes, nothing else. */
const HOST_PATTERN = /^[a-z0-9.-]+$/;

function isVercelPreviewHost(host: string): boolean {
  return HOST_PATTERN.test(host) && host.endsWith(VERCEL_PREVIEW_HOST_SUFFIX);
}

/**
 * The extra addresses a login system accepts sign-ins from, beyond its own
 * APP_URL/ADMIN_URL: a branch preview's own Vercel addresses, so Abhi can
 * sign in on a preview link. Empty everywhere else, and always empty in
 * production (APP_STAGE "production"), so the real site trusts only itself.
 * Previews sit behind Vercel's sign-in and use the dev database.
 */
export function previewTrustedOrigins(input: PreviewOriginInput): string[] {
  if (input.appStage !== DEVELOPMENT_STAGE) return [];
  if (input.vercelEnv !== VERCEL_PREVIEW_ENV) return [];
  const hosts = input.deploymentHosts
    .filter((host): host is string => typeof host === "string")
    .map((host) => host.trim().toLowerCase())
    .filter(isVercelPreviewHost);
  return [...new Set(hosts)].map((host) => `https://${host}`);
}
