import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailLayout, SmallPrint } from "./email-layout";

export interface RenterLinkCodeEmailProps {
  operatorName: string;
  code: string;
  /** How long it works, already worded, e.g. "10 minutes". */
  validFor: string;
}

const codeStyle = { fontSize: "28px", fontWeight: 700, letterSpacing: "6px" };

export function RenterLinkCodeEmail(props: RenterLinkCodeEmailProps): ReactElement {
  return (
    <EmailLayout
      preview={`Your code is ${props.code}`}
      heading="Your code"
      senderName={props.operatorName}
    >
      <Text>Type this code to open your details form from {props.operatorName}:</Text>
      <Text style={codeStyle}>{props.code}</Text>
      <SmallPrint>It works for {props.validFor}. Never share it with anyone.</SmallPrint>
      <SmallPrint>Did not ask for a code? You can ignore this email.</SmallPrint>
    </EmailLayout>
  );
}
