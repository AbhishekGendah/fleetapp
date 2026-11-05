/**
 * Each copy of an issued document emailed, or not, recorded so the rental
 * page says what really happened and the business can send it again
 * (review G7-1, G9-9).
 */
export const DOCUMENT_EMAIL_RECIPIENTS = ["renter", "business"] as const;
export type DocumentEmailRecipient = (typeof DOCUMENT_EMAIL_RECIPIENTS)[number];

/** "no_address": there was no email to send it to. */
export const DOCUMENT_EMAIL_OUTCOMES = ["sent", "failed", "no_address"] as const;
export type DocumentEmailOutcome = (typeof DOCUMENT_EMAIL_OUTCOMES)[number];

/** What a document's copies came to: the latest try for each recipient. */
export type DocumentEmailState = Readonly<
  Record<DocumentEmailRecipient, DocumentEmailOutcome | null>
>;

/** The latest outcome for each recipient, from every try, newest last. */
export function documentEmailState(
  tries: readonly { recipient: DocumentEmailRecipient; outcome: DocumentEmailOutcome }[],
): DocumentEmailState {
  const latest = (recipient: DocumentEmailRecipient): DocumentEmailOutcome | null =>
    tries.filter((attempt) => attempt.recipient === recipient).at(-1)?.outcome ?? null;
  return { renter: latest("renter"), business: latest("business") };
}

const RECIPIENT_WORDS: Readonly<Record<DocumentEmailRecipient, string>> = {
  renter: "the Renter",
  business: "you",
};

/** "Emailed to the Renter and to you", or what went wrong, for the rental page. */
export function documentEmailText(state: DocumentEmailState): string {
  const sentTo = DOCUMENT_EMAIL_RECIPIENTS.filter((recipient) => state[recipient] === "sent");
  const problems = DOCUMENT_EMAIL_RECIPIENTS.flatMap((recipient) => {
    const outcome = state[recipient];
    if (outcome === "failed") {
      return [`Couldn't email ${RECIPIENT_WORDS[recipient]}.`];
    }
    if (outcome === "no_address") {
      return [`Not emailed to ${RECIPIENT_WORDS[recipient]}: no email on file.`];
    }
    return [];
  });
  const sent =
    sentTo.length === 0
      ? []
      : [`Emailed to ${sentTo.map((r) => RECIPIENT_WORDS[r]).join(" and to ")}.`];
  return [...sent, ...problems].join(" ") || "Not emailed yet.";
}

/** Whether "Email again" is worth offering: a copy that should have gone and didn't. */
export function canEmailAgain(state: DocumentEmailState): boolean {
  return DOCUMENT_EMAIL_RECIPIENTS.some((recipient) => state[recipient] === "failed");
}
