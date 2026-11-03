import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailLayout, SmallPrint } from "./email-layout";

export interface BillingDocumentEmailProps {
  /** What it is, as printed on it: "Tax invoice", "Credit note", "Receipt", "Statement". */
  title: string;
  /** e.g. "INV-1001"; none for a statement. */
  numberText: string | null;
  renterName: string;
  operatorName: string;
  /** e.g. "1ABC234 Toyota Corolla, from 1 June 2027". */
  rentalSummary: string;
  /** The line the Renter most needs, already worded, e.g. "Total $350.00". */
  amountLine: string;
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
        {`Your ${props.title.toLowerCase()} from ${props.operatorName} for ${props.rentalSummary} is attached.`}
      </Text>
      <Text>{props.amountLine}</Text>
      <SmallPrint>
        Keep it for your records. It is fixed once issued: any correction comes as a credit note.
        Questions about it go to {props.operatorName}: reply to this email.
      </SmallPrint>
    </EmailLayout>
  );
}
