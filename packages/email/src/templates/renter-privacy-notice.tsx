import type { PrivacyNotice } from "@fleetapp/core";
import { Link, Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailLayout, SmallPrint } from "./email-layout";

export interface RenterPrivacyNoticeEmailProps {
  renterName: string;
  operatorName: string;
  /** The notice in the one wording every Renter page uses (packages/core privacy-notice). */
  notice: PrivacyNotice;
}

/**
 * The privacy notice for a Renter the business added itself, e.g. at the
 * counter (APP 5). A service message about the Renter's own details, not
 * marketing, so the Spam Act allows it without consent; it names the
 * business it is from.
 */
export function RenterPrivacyNoticeEmail(props: RenterPrivacyNoticeEmailProps): ReactElement {
  const { notice } = props;
  return (
    <EmailLayout
      preview={`How ${props.operatorName} looks after your information`}
      heading={notice.title}
      senderName={props.operatorName}
    >
      <Text>Hi {props.renterName},</Text>
      <Text>
        {props.operatorName} has added your details so they can rent you a car. This is how they
        look after them.
      </Text>
      {notice.paragraphs.map((paragraph) => (
        <Text key={paragraph}>{paragraph}</Text>
      ))}
      {notice.services.map((service) => (
        <Text key={service}>• {service}</Text>
      ))}
      <Text>{notice.policyText}</Text>
      {notice.policyUrl ? (
        <Text>
          <Link href={notice.policyUrl}>Read the privacy policy</Link>
        </Text>
      ) : null}
      {notice.contact ? <SmallPrint>{notice.contact}</SmallPrint> : null}
    </EmailLayout>
  );
}
