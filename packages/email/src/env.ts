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
  /**
   * Ours, not Vercel's: "production" only in the real production project
   * (with real Renters). Vercel calls the dev site "production" too, since it
   * is built from main, so its own label cannot be used for this.
   */
  APP_STAGE: z.enum(["development", "production"]).optional(),
};

/**
 * The test inbox holds working Renter links, codes and invite links, and the
 * admin site shows it: it runs only where APP_STAGE=development is set
 * outright, so a live site with the setting forgotten fails at start-up
 * instead of sending real Renters' emails to it (review A9-7, fail fast).
 */
export function refuseTestInboxInProduction(
  env: { EMAIL_TRANSPORT: string; APP_STAGE?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (env.EMAIL_TRANSPORT === "dev_outbox" && env.APP_STAGE !== "development") {
    context.addIssue({
      code: "custom",
      path: ["APP_STAGE"],
      message:
        "EMAIL_TRANSPORT=dev_outbox (the test inbox) is for development only: set APP_STAGE=development.",
    });
  }
}
