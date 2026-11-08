import { Text } from "@react-email/components";
import type { ReactElement } from "react";

import { EmailLayout, SmallPrint } from "./email-layout";

/** The fixed documents emailed as a copy once made: a signed contract or change of terms, a handover or return report. */
export const COPIED_DOCUMENT_KINDS = [
  "contract",
  "handover_report",
  "return_report",
  "change_of_terms",
  "swap_form",
] as const;
export type CopiedDocumentKind = (typeof COPIED_DOCUMENT_KINDS)[number];

export type DocumentCopyAudience = "renter" | "driver" | "operator";

export interface DocumentCopyEmailProps {
  kind: CopiedDocumentKind;
  /**
   * The Renter gets their copy; a business's driver their own copy of the
   * papers they signed for its car (rule 15); the business its copy and what
   * happened.
   */
  audience: DocumentCopyAudience;
  renterName: string;
  operatorName: string;
  /** e.g. "1ABC234 Toyota Corolla, from 1 June 2027". */
  rentalSummary: string;
  /** When it was signed or accepted, e.g. "3 Nov 2026, 2:15 pm AWST". */
  at: string;
  /**
   * A business's paper: who signed it for the business, by its legal name. Its
   * driver for a car changing hands (rule 15); the authorised person for a
   * contract or change of terms (decision 3).
   */
  forBusiness?: { driverName: string; businessName: string };
}

type BusinessCar = NonNullable<DocumentCopyEmailProps["forBusiness"]>;

/** A business's paper: its signer did it, for the business, so the lines say so. */
interface BusinessWording {
  operatorPreview: (car: BusinessCar) => string;
  renterLine: (props: DocumentCopyEmailProps, car: BusinessCar) => string;
  operatorLine: (props: DocumentCopyEmailProps, car: BusinessCar) => string;
}

const BUSINESS_WORDING: Readonly<Partial<Record<CopiedDocumentKind, BusinessWording>>> = {
  contract: {
    operatorPreview: (signer) => `${signer.driverName} signed for ${signer.businessName}`,
    renterLine: (props, signer) =>
      `Thank you for signing the rental contract for ${signer.businessName} with ${props.operatorName} for ${props.rentalSummary}. The signed copy is attached: keep it for your records.`,
    operatorLine: (props, signer) =>
      `${signer.driverName} signed ${signer.businessName}'s contract for ${props.rentalSummary} on ${props.at}. The signed copy is attached, and kept with the rental.`,
  },
  change_of_terms: {
    operatorPreview: (signer) =>
      `${signer.driverName} signed a change of terms for ${signer.businessName}`,
    renterLine: (props, signer) =>
      `Thank you for signing the change to ${signer.businessName}'s rental with ${props.operatorName} for ${props.rentalSummary}. The signed copy is attached: keep it with the contract.`,
    operatorLine: (props, signer) =>
      `${signer.driverName} signed the change of terms for ${signer.businessName}, ${props.rentalSummary}, on ${props.at}. The signed copy is attached, and kept with the rental.`,
  },
  handover_report: {
    operatorPreview: (car) => `${car.driverName} accepted a car for ${car.businessName}`,
    renterLine: (props, car) =>
      `${car.driverName} received ${props.rentalSummary} from ${props.operatorName} for ${car.businessName}. The report they accepted, with the kilometres, fuel and photos of the car, is attached: keep it for your records.`,
    operatorLine: (props, car) =>
      `${car.driverName} accepted ${props.rentalSummary} for ${car.businessName} on ${props.at}. The handover report is attached, and kept with the rental.`,
  },
  return_report: {
    operatorPreview: (car) => `${car.businessName}'s car is back`,
    renterLine: (props, car) =>
      `${car.businessName}'s car, ${props.rentalSummary}, was returned to ${props.operatorName}. The return report, with the kilometres, fuel and photos of the car at handover and at return, is attached: keep it for your records.`,
    operatorLine: (props, car) =>
      `${car.businessName}'s car, ${props.rentalSummary}, was returned on ${props.at}. The return report is attached, and kept with the rental.`,
  },
  swap_form: {
    operatorPreview: (car) => `${car.driverName} swapped cars for ${car.businessName}`,
    renterLine: (props, car) =>
      `${car.driverName} swapped cars with ${props.operatorName} for ${car.businessName}: ${car.businessName} now has ${props.rentalSummary}. The swap form ${car.driverName} signed is attached, and the reports for both cars come in their own emails.`,
    operatorLine: (props, car) =>
      `${car.driverName} swapped ${car.businessName} into ${props.rentalSummary} on ${props.at}. The signed swap form is attached, and kept with the rental.`,
  },
};

interface Wording {
  preview: { renter: string; operator: (renterName: string) => string };
  heading: { renter: string; operator: string };
  /** `forWhom`: " for <business>" on a driver's own copy, else nothing. */
  renterLine: (props: DocumentCopyEmailProps, forWhom: string) => string;
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
    renterLine: (props, forWhom) =>
      `You received ${props.rentalSummary} from ${props.operatorName}${forWhom}. The report you accepted, with the kilometres, fuel and photos of the car, is attached: keep it for your records.`,
    operatorLine: (props) =>
      `${props.renterName} accepted ${props.rentalSummary} on ${props.at}. The handover report is attached, and kept with the rental.`,
    smallPrint: (at) =>
      `Accepted on ${at}. The report is fixed: it can never be changed, so it shows the car as it was handed over.`,
  },
  change_of_terms: {
    preview: {
      renter: "Your signed change of terms",
      operator: (renterName) => `${renterName} signed a change of terms`,
    },
    heading: { renter: "Your signed change of terms", operator: "Change of terms signed" },
    renterLine: (props) =>
      `Thank you for signing the change to your rental with ${props.operatorName} for ${props.rentalSummary}. Your copy is attached: keep it with your contract.`,
    operatorLine: (props) =>
      `${props.renterName} signed the change of terms for ${props.rentalSummary} on ${props.at}. The signed copy is attached, and kept with the rental.`,
    smallPrint: (at) =>
      `Signed on ${at}. The last page records how it was signed, and the fingerprint that proves the document has not changed.`,
  },
  swap_form: {
    preview: {
      renter: "Your car swap form",
      operator: (renterName) => `${renterName} swapped cars`,
    },
    heading: { renter: "Your car swap", operator: "Car swapped" },
    renterLine: (props, forWhom) =>
      `You swapped cars with ${props.operatorName}${forWhom}: you now have ${props.rentalSummary}. The swap form you signed is attached, and the reports for both cars come in their own emails.`,
    operatorLine: (props) =>
      `${props.renterName} swapped into ${props.rentalSummary} on ${props.at}. The signed swap form is attached, and kept with the rental.`,
    smallPrint: (at) => `Signed on ${at}. The form is fixed: it can never be changed.`,
  },
  return_report: {
    preview: {
      renter: "Your car return report",
      operator: (renterName) => `${renterName}'s car is back`,
    },
    heading: { renter: "Your return report", operator: "Car returned" },
    renterLine: (props, forWhom) =>
      `You returned ${props.rentalSummary} to ${props.operatorName}${forWhom}. The return report, with the kilometres, fuel and photos of the car at handover and at return, is attached: keep it for your records.`,
    operatorLine: (props) =>
      `${props.renterName}'s car, ${props.rentalSummary}, was returned on ${props.at}. The return report is attached, and kept with the rental.`,
    smallPrint: (at) =>
      `Returned on ${at}. The report is fixed: it can never be changed, so it shows the car as it came back.`,
  },
};

/**
 * The lines for this copy: a business's own when its driver had the car,
 * else the Renter's. The driver's own copy is worded to them as the one who
 * had the car, for the business ("You received … for Acme Rideshare Pty Ltd").
 */
function linesFor(props: DocumentCopyEmailProps) {
  const wording = WORDING[props.kind];
  const car = props.forBusiness;
  const business = car ? BUSINESS_WORDING[props.kind] : undefined;
  const driverLine = car ? wording.renterLine(props, ` for ${car.businessName}`) : undefined;
  if (!car || !business) {
    return {
      operatorPreview: wording.preview.operator(props.renterName),
      renterLine: wording.renterLine(props, ""),
      driverLine,
      operatorLine: wording.operatorLine(props),
    };
  }
  return {
    operatorPreview: business.operatorPreview(car),
    renterLine: business.renterLine(props, car),
    driverLine,
    operatorLine: business.operatorLine(props, car),
  };
}

/** Who a copy greets and what it says to them; none for the business's own copy. */
function greetingFor(
  props: DocumentCopyEmailProps,
  lines: ReturnType<typeof linesFor>,
): { name: string; line: string } | null {
  if (props.audience === "operator") {
    return null;
  }
  if (props.audience === "driver" && props.forBusiness && lines.driverLine) {
    return { name: props.forBusiness.driverName, line: lines.driverLine };
  }
  return { name: props.renterName, line: lines.renterLine };
}

export function DocumentCopyEmail(props: DocumentCopyEmailProps): ReactElement {
  const wording = WORDING[props.kind];
  const lines = linesFor(props);
  const greeting = greetingFor(props, lines);
  return (
    <EmailLayout
      preview={greeting ? wording.preview.renter : lines.operatorPreview}
      heading={greeting ? wording.heading.renter : wording.heading.operator}
      senderName={greeting ? props.operatorName : undefined}
    >
      {greeting ? (
        <>
          <Text>Hi {greeting.name},</Text>
          <Text>{greeting.line}</Text>
        </>
      ) : (
        <Text>{lines.operatorLine}</Text>
      )}
      <SmallPrint>{wording.smallPrint(props.at)}</SmallPrint>
    </EmailLayout>
  );
}
