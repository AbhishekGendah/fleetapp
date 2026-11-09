import { formatAbn, type RenterKind, type TemplateBlock } from "@fleetapp/core";

import { line, paragraph } from "../handover/handover-report";

/**
 * Who a money document is addressed to (docs/plans/business-renters.md,
 * decisions 7 and 8). A business by its legal name, trading name, ABN, its
 * contact and its address, so it can claim the GST back; a person by their
 * name, with their ABN when they gave one as a sole trader. Never a person's
 * home address, licence or date of birth.
 */
export interface BilledTo {
  kind: RenterKind;
  /** A person's full name, or a business's legal name. */
  name: string;
  tradingName: string | null;
  abn: string | null;
  /** A business's contact, who the documents are for the attention of. */
  contactName: string | null;
  /** A business's postal address, else its business address. */
  address: string | null;
}

/** The Renter's columns a document reads to address it. */
export interface BilledToColumns {
  kind: RenterKind;
  fullName: string;
  tradingName: string | null;
  abn: string | null;
  contactName: string | null;
  businessAddress: string | null;
  postalAddress: string | null;
}

/** Who a document is addressed to, from the Renter as saved. Pure. */
export function billedToOf(renter: BilledToColumns): BilledTo {
  const isBusiness = renter.kind === "organisation";
  return {
    kind: renter.kind,
    name: renter.fullName,
    tradingName: isBusiness ? renter.tradingName : null,
    abn: renter.abn,
    contactName: isBusiness ? renter.contactName : null,
    address: isBusiness ? (renter.postalAddress ?? renter.businessAddress) : null,
  };
}

/** The "To" lines of a document, in the order an invoice is read. Pure. */
export function billedToBlocks(billedTo: BilledTo): TemplateBlock[] {
  return [
    paragraph(billedTo.name),
    ...(billedTo.tradingName ? [paragraph(`Trading as ${billedTo.tradingName}`)] : []),
    ...(billedTo.abn ? [line("ABN", formatAbn(billedTo.abn))] : []),
    ...(billedTo.contactName ? [line("Attention", billedTo.contactName)] : []),
    ...(billedTo.address ? [paragraph(billedTo.address)] : []),
  ];
}

/** Who a document's email greets: a business's contact, whose email it is, else the Renter. */
export function greetingNameOf(billedTo: BilledTo): string {
  return billedTo.contactName ?? billedTo.name;
}
