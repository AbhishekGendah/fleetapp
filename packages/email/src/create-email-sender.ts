import type { AnyDatabase } from "@fleetapp/db/client";

import { createDevOutboxSender } from "./dev-outbox-sender";
import type { EmailSender, EmailTransport } from "./email-sender";

export interface EmailSenderConfig {
  transport: EmailTransport;
  /** Where the test inbox is written. Each app passes its own connection. */
  database: AnyDatabase;
  from: string;
}

/** The sender `EMAIL_TRANSPORT` asks for. Postmark joins the switch when it is set up. */
export function createEmailSender(config: EmailSenderConfig): EmailSender {
  switch (config.transport) {
    case "dev_outbox":
      return createDevOutboxSender({ database: config.database, from: config.from });
  }
}
