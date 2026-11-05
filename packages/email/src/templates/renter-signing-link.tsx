import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import {
  EmailButton,
  EmailLayout,
  SmallPrint,
  NotExpectingNote,
  type ReplyAware,
} from "./email-layout";

/** What the link is for: the rental contract, or a change to it. */
export type SignedDocumentKind = "contract" | "change_of_terms";

const DOCUMENT_WORDS: Readonly<
  Record<SignedDocumentKind, { name: string; button: string; sent: string }>
> = {
  contract: {
    name: "rental contract",
    button: "Read and sign your contract",
    sent: "your rental contract",
  },
  change_of_terms: {
    name: "change of terms",
    button: "Read and sign the change",
    sent: "a change to your rental",
  },
};

export interface RenterSigningLinkEmailProps extends ReplyAware {
  /** The contract unless said otherwise. */
  document?: SignedDocumentKind;
  renterName: string;
  operatorName: string;
  /** e.g. "1ABC234 Toyota Corolla, from 1 June 2027". */
  rentalSummary: string;
  linkUrl: string;
  /** When the link stops working, already worded, e.g. "Friday 6 November". */
  validUntil: string;
}

export function RenterSigningLinkEmail(props: RenterSigningLinkEmailProps): ReactElement {
  const words = DOCUMENT_WORDS[props.document ?? "contract"];
  const title = `Your ${words.name}`;
  return (
    <EmailLayout
      preview={`${title} from ${props.operatorName}`}
      heading={title}
      senderName={props.operatorName}
    >
      <Text>Hi {props.renterName},</Text>
      <Text>
        {props.operatorName} has sent {words.sent} for {props.rentalSummary}. Please read it and
        sign it on your phone.
      </Text>
      <EmailButton href={props.linkUrl}>{words.button}</EmailButton>
      <SmallPrint>
        The link works until {props.validUntil}. The first time you open it on a phone, we will
        email you a code to type in. You will get a copy of the signed {words.name} by email.
      </SmallPrint>
      <NotExpectingNote operatorName={props.operatorName} canReply={props.canReply} />
    </EmailLayout>
  );
}
