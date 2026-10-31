/** What sending a details link came back with. The address is shown once, to copy. */
export type LinkSendState =
  | { status: "idle" }
  | { status: "sent"; url: string; expiresText: string }
  | { status: "failed"; message: string };

export const INITIAL_LINK_SEND_STATE: LinkSendState = { status: "idle" };
