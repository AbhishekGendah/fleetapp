/** A rendered email, ready to hand to whichever way of sending is set up. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text version, for email clients and spam filters that want one. */
  text: string;
  /** Shown as who it is from in place of the usual name, e.g. the Operator's business for Renter emails. */
  fromName?: string;
  /** Where a reply goes, e.g. the Operator's email for Renter emails. */
  replyTo?: string;
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

/** The address inside `Name <address>`, or the whole thing when it has no name. */
function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match?.[1] ?? from).trim();
}

/**
 * Who an email is from: the usual sender, or the same address under another
 * name. Quotes and line breaks are taken out of the name, so it cannot add
 * headers of its own.
 */
export function senderFor(from: string, fromName?: string): string {
  if (!fromName) {
    return from;
  }
  const safeName = fromName.replace(/["\\\r\n<>]/g, "").trim();
  return safeName ? `"${safeName}" <${addressOf(from)}>` : from;
}
