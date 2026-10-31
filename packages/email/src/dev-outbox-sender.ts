import type { AnyDatabase } from "@fleetapp/db/client";
import { devEmailOutbox } from "@fleetapp/db/schema";

import { senderFor, type EmailMessage, type EmailSender } from "./email-sender";

export interface DevOutboxSenderConfig {
  database: AnyDatabase;
  /** Sender name and address, e.g. `Name <no-reply@example.com>`. */
  from: string;
}

/**
 * Keeps every email in the test inbox instead of sending it. For development
 * only: the inbox holds working links, and is readable from the admin site.
 */
export function createDevOutboxSender(config: DevOutboxSenderConfig): EmailSender {
  return {
    async send(message: EmailMessage): Promise<void> {
      await config.database.insert(devEmailOutbox).values({
        toAddress: message.to,
        fromAddress: senderFor(config.from, message.fromName),
        replyTo: message.replyTo ?? null,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    },
  };
}
