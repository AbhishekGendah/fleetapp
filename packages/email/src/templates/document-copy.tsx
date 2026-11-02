import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailLayout, SmallPrint } from "./email-layout";

/** The fixed documents emailed as a copy once made: a signed contract, a handover report. */
export const COPIED_DOCUMENT_KINDS = ["contract", "handover_report"] as const;
export type CopiedDocumentKind = (typeof COPIED_DOCUMENT_KINDS)[number];

export interface DocumentCopyEmailProps {
  kind: CopiedDocumentKind;
  /** The Renter gets their copy; the business gets its copy and what happened. */
  audience: "renter" | "operator";
  renterName: string;
  operatorName: string;
  /** e.g. "1ABC234 Toyota Corolla, from 1 June 2027". */
  rentalSummary: string;
  /** When it was signed or accepted, e.g. "3 Nov 2026, 2:15 pm AWST". */
  at: string;
}

interface Wording {
  preview: { renter: string; operator: (renterName: string) => string };
  heading: { renter: string; operator: string };
  renterLine: (props: DocumentCopyEmailProps) => string;
  operatorLine: (props: DocumentCopyEmailProps) => string;
  smallPrint: (at: string) => string;
}

const WORDING: Readonly<Record<CopiedDocumentKind, Wording>> = {
  contract: {
    preview: {
      renter: "Your signed rental contract",
      operator: (renterName) => `${renterName} signed their contract`,
    },
    heading: { renter: "Your signed contract", operator: "Contract signed" },
    renterLine: (props) =>
      `Thank you for signing your rental contract with ${props.operatorName} for ${props.rentalSummary}. Your copy is attached: keep it for your records.`,
    operatorLine: (props) =>
      `${props.renterName} signed their contract for ${props.rentalSummary} on ${props.at}. The signed copy is attached, and kept with the rental.`,
    smallPrint: (at) =>
      `Signed on ${at}. The last page records how it was signed, and the fingerprint that proves the document has not changed.`,
  },
  handover_report: {
    preview: {
      renter: "Your car handover report",
      operator: (renterName) => `${renterName} accepted their car`,
    },
    heading: { renter: "Your handover report", operator: "Car handed over" },
    renterLine: (props) =>
      `You received ${props.rentalSummary} from ${props.operatorName}. The report you accepted, with the kilometres, fuel and photos of the car, is attached: keep it for your records.`,
    operatorLine: (props) =>
      `${props.renterName} accepted ${props.rentalSummary} on ${props.at}. The handover report is attached, and kept with the rental.`,
    smallPrint: (at) =>
      `Accepted on ${at}. The report is fixed: it can never be changed, so it shows the car as it was handed over.`,
  },
};

export function DocumentCopyEmail(props: DocumentCopyEmailProps): ReactElement {
  const wording = WORDING[props.kind];
  const isForRenter = props.audience === "renter";
  return (
    <EmailLayout
      preview={isForRenter ? wording.preview.renter : wording.preview.operator(props.renterName)}
      heading={isForRenter ? wording.heading.renter : wording.heading.operator}
      senderName={isForRenter ? props.operatorName : undefined}
    >
      {isForRenter ? (
        <>
          <Text>Hi {props.renterName},</Text>
          <Text>{wording.renterLine(props)}</Text>
        </>
      ) : (
        <Text>{wording.operatorLine(props)}</Text>
      )}
      <SmallPrint>{wording.smallPrint(props.at)}</SmallPrint>
    </EmailLayout>
  );
}
