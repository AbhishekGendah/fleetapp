import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailButton, EmailLayout, SmallPrint } from "./email-layout";

export interface RenterDetailsLinkEmailProps {
  renterName: string;
  operatorName: string;
  linkUrl: string;
  /** When the link stops working, already worded, e.g. "Friday 6 November". */
  validUntil: string;
}

export function RenterDetailsLinkEmail(props: RenterDetailsLinkEmailProps): ReactElement {
  return (
    <EmailLayout
      preview={`Your details form from ${props.operatorName}`}
      heading="Your details form"
      senderName={props.operatorName}
    >
      <Text>Hi {props.renterName},</Text>
      <Text>
        {props.operatorName} has asked you to check your details and add a photo of your licence
        before you rent from them. It takes a few minutes on your phone.
      </Text>
      <EmailButton href={props.linkUrl}>Open your details form</EmailButton>
      <SmallPrint>
        The link works until {props.validUntil}. The first time you open it on a phone, we will
        email you a code to type in.
      </SmallPrint>
      <SmallPrint>
        Not expecting this? Ignore this email, or reply to let {props.operatorName} know.
      </SmallPrint>
    </EmailLayout>
  );
}
