import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailLayout, SmallPrint, type ReplyAware } from "./email-layout";

export interface BillingDocumentEmailProps extends ReplyAware {
  /** What it is, as printed on it: "Tax invoice", "Credit note", "Receipt", "Statement". */
  title: string;
  /** e.g. "INV-1001"; none for a statement. */
  numberText: string | null;
  /** Who it greets: the Renter, or a business's contact. */
  renterName: string;
  operatorName: string;
  /** e.g. "1ABC234 Toyota Corolla, from 1 June 2027". */
  rentalSummary: string;
  /** A business Renter's legal name, which the document is addressed to; none for a person. */
  businessName?: string | undefined;
  /** The line the Renter most needs, already worded, e.g. "Total $350.00". */
  amountLine: string;
  /**
   * An invoice for one-off charges (docs/plans/one-off-charge-notice.md): each
   * charge with its amount and GST, e.g. "Cleaning: $120.00, including GST of $10.91."
   */
  chargeLines?: readonly string[] | undefined;
  /** When and from which account it will be debited, if it will be; already worded. */
  debitLine?: string | undefined;
  /** How to reach the business about it, already worded. */
  contactLine?: string | undefined;
}

/** The heading and subject's name for a document: "Tax invoice INV-1001", "Statement". */
export function billingDocumentName(
  props: Pick<BillingDocumentEmailProps, "title" | "numberText">,
): string {
  return props.numberText ? `${props.title} ${props.numberText}` : props.title;
}

/** An invoice, credit note, receipt or statement, sent to the Renter from the business with the PDF attached. */
export function BillingDocumentEmail(props: BillingDocumentEmailProps): ReactElement {
  const name = billingDocumentName(props);
  return (
    <EmailLayout
      preview={`${name} from ${props.operatorName}`}
      heading={name}
      senderName={props.operatorName}
    >
      <Text>Hi {props.renterName},</Text>
      <Text>
        {props.businessName
          ? `The ${props.title.toLowerCase()} from ${props.operatorName} to ${props.businessName} for ${props.rentalSummary} is attached.`
          : `Your ${props.title.toLowerCase()} from ${props.operatorName} for ${props.rentalSummary} is attached.`}
      </Text>
      {props.chargeLines?.map((line) => (
        <Text key={line}>{line}</Text>
      ))}
      <Text>{props.amountLine}</Text>
      {props.debitLine ? <Text>{props.debitLine}</Text> : null}
      {props.contactLine ? <Text>{props.contactLine}</Text> : null}
      <SmallPrint>
        Keep it for your records. It is fixed once issued: any correction comes as a credit note.
        {props.canReply
          ? `Questions about it go to ${props.operatorName}: reply to this email.`
          : `Questions about it go to ${props.operatorName}.`}
      </SmallPrint>
    </EmailLayout>
  );
}
