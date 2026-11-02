import { mergeFieldLabel } from "@fleetapp/core";

import type { LinkSendState } from "../renter-links/link-send-state";
import type { SendSigningLinkResult } from "./signing-links";

/** What the message names: "contract" or "change of terms". */
type DocumentName = "contract" | "change of terms";

const SETTINGS_TEMPLATE_NAMES: Readonly<Record<DocumentName, string>> = {
  contract: "your contract template",
  "change of terms": "a Change of terms template",
};

/** Why a signing link was not sent, in words for the Operator. */
export function signingLinkNotSentState(
  result: Exclude<SendSigningLinkResult, { status: "sent" }>,
  name: DocumentName,
): LinkSendState {
  if (result.status === "missing") {
    const labels = result.fields.map(mergeFieldLabel);
    return {
      status: "failed",
      message: `Fill in what the ${name} needs first: ${labels.join(", ")}.`,
    };
  }
  const messages: Record<Exclude<SendSigningLinkResult["status"], "sent" | "missing">, string> = {
    not_found: "That rental could not be found.",
    not_signable:
      name === "contract"
        ? "Only a draft or booked rental’s contract can be sent for signing."
        : "This change can no longer be signed: it was withdrawn, or the rental is over.",
    no_email: "Add the Renter’s email first: the link and its codes are sent there.",
    no_template: `Set up ${SETTINGS_TEMPLATE_NAMES[name]} first, in Settings → Contracts.`,
    already_signed: `This ${name} is already signed.`,
  };
  return { status: "failed", message: messages[result.status] };
}
