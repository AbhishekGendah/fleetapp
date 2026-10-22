/** A rendered email, ready to hand to whichever way of sending is set up. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text version, for email clients and spam filters that want one. */
  text: string;
}

/**
 * The one way the apps send email. What is behind it is a setting
 * (`EMAIL_TRANSPORT`), so no code ever checks "am I in production?".
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * The ways of sending email. Postmark joins this list when it is set up; until
 * then every email lands in the test inbox.
 */
export const EMAIL_TRANSPORTS = ["dev_outbox"] as const;
export type EmailTransport = (typeof EMAIL_TRANSPORTS)[number];
