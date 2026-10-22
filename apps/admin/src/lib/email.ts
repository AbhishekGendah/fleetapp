import { createDevOutboxSender, type EmailSender, type EmailTransport } from "@fleetapp/email";

import { env } from "../env";
import { appDb } from "./app-db";

function createEmailSender(transport: EmailTransport): EmailSender {
  switch (transport) {
    case "dev_outbox":
      return createDevOutboxSender({ database: appDb, from: env.EMAIL_FROM });
  }
}

export const emailSender = createEmailSender(env.EMAIL_TRANSPORT);

/** The test inbox page exists only while emails are going into it. */
export const isDevOutboxEnabled = env.EMAIL_TRANSPORT === "dev_outbox";
