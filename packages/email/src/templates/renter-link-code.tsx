import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailLayout, SmallPrint } from "./email-layout";

export interface RenterLinkCodeEmailProps {
  operatorName: string;
  code: string;
  /** How long it works, already worded, e.g. "10 minutes". */
  validFor: string;
  /** What the link is for, e.g. "sign your rental contract". */
  purposeWords: string;
}

const codeStyle = { fontSize: "28px", fontWeight: 700, letterSpacing: "6px" };

export function RenterLinkCodeEmail(props: RenterLinkCodeEmailProps): ReactElement {
  return (
    <EmailLayout
      // Not the code: previews show on lock screens.
      preview={`Your code to ${props.purposeWords} with ${props.operatorName}`}
      heading="Your code"
      senderName={props.operatorName}
    >
      <Text>
        Type this code to {props.purposeWords} with {props.operatorName}:
      </Text>
      <Text style={codeStyle}>{props.code}</Text>
      <SmallPrint>It works for {props.validFor}. Never share it with anyone.</SmallPrint>
      <SmallPrint>Did not ask for a code? You can ignore this email.</SmallPrint>
    </EmailLayout>
  );
}
