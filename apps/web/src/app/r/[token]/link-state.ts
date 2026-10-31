/** What a code step came back with, for the Renter's link page. */
export type CodeStepState =
  { status: "idle" } | { status: "code_sent" } | { status: "problem"; message: string };

export const INITIAL_CODE_STEP_STATE: CodeStepState = { status: "idle" };

/** What sending the details form came back with. */
export type SendDetailsState =
  { status: "idle" } | { status: "sent" } | { status: "problem"; message: string };

export const INITIAL_SEND_DETAILS_STATE: SendDetailsState = { status: "idle" };

/** The private cookie that remembers a phone for one link; its path is that link's page. */
export const DEVICE_COOKIE = "renter_link_device";

export { renterLinkPagePath as linkPagePath } from "../../../lib/paths";
