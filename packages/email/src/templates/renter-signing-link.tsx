import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailButton, EmailLayout, SmallPrint } from "./email-layout";

export interface RenterSigningLinkEmailProps {
  renterName: string;
  operatorName: string;
  /** e.g. "1ABC234 Toyota Corolla, from 1 June 2027". */
  rentalSummary: string;
  linkUrl: string;
  /** When the link stops working, already worded, e.g. "Friday 6 November". */
  validUntil: string;
}

export function RenterSigningLinkEmail(props: RenterSigningLinkEmailProps): ReactElement {
  return (
    <EmailLayout
      preview={`Your rental contract from ${props.operatorName}`}
      heading="Your rental contract"
      senderName={props.operatorName}
    >
      <Text>Hi {props.renterName},</Text>
      <Text>
        {props.operatorName} has sent your rental contract for {props.rentalSummary}. Please read it
        and sign it on your phone.
      </Text>
      <EmailButton href={props.linkUrl}>Read and sign your contract</EmailButton>
      <SmallPrint>
        The link works until {props.validUntil}. The first time you open it on a phone, we will
        email you a code to type in. You will get a copy of the signed contract by email.
      </SmallPrint>
      <SmallPrint>
        Not expecting this? Ignore this email, or reply to let {props.operatorName} know.
      </SmallPrint>
    </EmailLayout>
  );
}
