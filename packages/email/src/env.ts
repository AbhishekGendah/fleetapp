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
};
