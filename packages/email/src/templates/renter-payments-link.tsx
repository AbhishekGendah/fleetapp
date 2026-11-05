import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import {
  EmailButton,
  EmailLayout,
  SmallPrint,
  NotExpectingNote,
  type ReplyAware,
} from "./email-layout";

export interface RenterPaymentsLinkEmailProps extends ReplyAware {
  renterName: string;
  operatorName: string;
  /** e.g. "1ABC234 Toyota Corolla, from 1 June 2027". */
  rentalSummary: string;
  linkUrl: string;
  /** When the link stops working, already worded, e.g. "Friday 6 November". */
  validUntil: string;
}

/**
 * The link to set up a rental's direct debit and pay its bond. The details
 * are given on Stripe's own page, never in the email or to us.
 */
export function RenterPaymentsLinkEmail(props: RenterPaymentsLinkEmailProps): ReactElement {
  const title = "Set up your payments";
  return (
    <EmailLayout
      preview={`${title} for ${props.operatorName}`}
      heading={title}
      senderName={props.operatorName}
    >
      <Text>Hi {props.renterName},</Text>
      <Text>
        {props.operatorName} has asked you to set up the direct debit for {props.rentalSummary}, and
        to pay the bond if it is still owing. It takes a couple of minutes on your phone.
      </Text>
      <EmailButton href={props.linkUrl}>Set up your payments</EmailButton>
      <SmallPrint>
        The link works until {props.validUntil}. The first time you open it on a phone, we will
        email you a code to type in. Your bank or card details are entered on Stripe&apos;s secure
        page, never in an email.
      </SmallPrint>
      <NotExpectingNote operatorName={props.operatorName} canReply={props.canReply} />
    </EmailLayout>
  );
}
