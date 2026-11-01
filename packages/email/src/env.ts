import { z } from "zod";

import { EMAIL_TRANSPORTS } from "./email-sender";

/** The settings every app that sends email needs. */
export const emailEnvShape = {
  /**
   * How email is sent. `dev_outbox` keeps every email in the test inbox on the
   * admin site instead of sending it, and must never be used in production.
   */
  EMAIL_TRANSPORT: z.enum(EMAIL_TRANSPORTS),
  /** Sender name and address, e.g. `Name <no-reply@example.com>`. */
  EMAIL_FROM: z.string().min(1),
  /** Set by Vercel itself on its servers; empty on a laptop or in CI. */
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
};

/**
 * The test inbox holds working Renter links, codes and invite links, and the
 * admin site shows it: production must never start on it (fail fast).
 */
export function refuseTestInboxInProduction(
  env: { EMAIL_TRANSPORT: string; VERCEL_ENV?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (env.VERCEL_ENV === "production" && env.EMAIL_TRANSPORT === "dev_outbox") {
    context.addIssue({
      code: "custom",
      path: ["EMAIL_TRANSPORT"],
      message: "EMAIL_TRANSPORT=dev_outbox must never be used in production.",
    });
  }
}
