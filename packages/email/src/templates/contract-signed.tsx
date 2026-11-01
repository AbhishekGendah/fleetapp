import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailLayout, SmallPrint } from "./email-layout";

export interface ContractSignedEmailProps {
  /** The Renter gets their copy; the business gets its copy and who signed. */
  audience: "renter" | "operator";
  renterName: string;
  operatorName: string;
  /** e.g. "1ABC234 Toyota Corolla, from 1 June 2027". */
  rentalSummary: string;
  /** e.g. "3 Nov 2026, 2:15 pm AWST". */
  signedAt: string;
}

export function ContractSignedEmail(props: ContractSignedEmailProps): ReactElement {
  const isForRenter = props.audience === "renter";
  return (
    <EmailLayout
      preview={
        isForRenter ? "Your signed rental contract" : `${props.renterName} signed their contract`
      }
      heading={isForRenter ? "Your signed contract" : "Contract signed"}
      senderName={isForRenter ? props.operatorName : undefined}
    >
      {isForRenter ? (
        <>
          <Text>Hi {props.renterName},</Text>
          <Text>
            Thank you for signing your rental contract with {props.operatorName} for{" "}
            {props.rentalSummary}. Your copy is attached: keep it for your records.
          </Text>
        </>
      ) : (
        <Text>
          {props.renterName} signed their contract for {props.rentalSummary} on {props.signedAt}.
          The signed copy is attached, and kept with the rental.
        </Text>
      )}
      <SmallPrint>
        Signed on {props.signedAt}. The last page records how it was signed, and the fingerprint
        that proves the document has not changed.
      </SmallPrint>
    </EmailLayout>
  );
}
