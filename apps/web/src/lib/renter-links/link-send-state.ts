import { formatDateTimeInTimeZone } from "@fleetapp/core";

/** What sending a Renter link came back with. The address is shown once, to copy. */
export type LinkSendState =
  | { status: "idle" }
  | { status: "sent"; url: string; expiresText: string; isEmailed: boolean }
  | { status: "failed"; message: string };

export const INITIAL_LINK_SEND_STATE: LinkSendState = { status: "idle" };

/** A link just sent, as the sender shows it: its address to copy and when it stops working. */
export function linkSentState(
  sent: { url: string; expiresAt: Date; isEmailed: boolean },
  timeZone: string,
): LinkSendState {
  return {
    status: "sent",
    url: sent.url,
    expiresText: formatDateTimeInTimeZone(sent.expiresAt, timeZone),
    isEmailed: sent.isEmailed,
  };
}
