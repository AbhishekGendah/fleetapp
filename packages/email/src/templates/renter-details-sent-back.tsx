import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailLayout, SmallPrint } from "./email-layout";

export interface RenterDetailsSentBackEmailProps {
  operatorName: string;
  /** The Operator's note on what to change, in their words. */
  note: string;
  /** Until when the link they already have works, already worded in the Operator's timezone. */
  linkWorksUntil: string;
}

const noteStyle = {
  whiteSpace: "pre-line" as const,
  borderLeft: "4px solid #d0d5dd",
  paddingLeft: "12px",
};

/**
 * The details a Renter sent need a change. The link itself is not in this
 * email: only its fingerprint is kept, so the Renter uses the one already sent.
 */
export function RenterDetailsSentBackEmail(props: RenterDetailsSentBackEmailProps): ReactElement {
  return (
    <EmailLayout
      preview={`${props.operatorName} asked you to change your details`}
      heading="Please check your details"
      senderName={props.operatorName}
    >
      <Text>{props.operatorName} looked at the details you sent and asked you to change something:</Text>
      <Text style={noteStyle}>{props.note}</Text>
      <Text>
        Open the link in the earlier email from {props.operatorName}, make the change and send it
        again. It works until {props.linkWorksUntil}.
      </Text>
      <SmallPrint>
        If the link has stopped working, reply to this email and ask for a new one.
      </SmallPrint>
    </EmailLayout>
  );
}
