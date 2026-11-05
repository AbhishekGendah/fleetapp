import {
  formatKilometres,
  FUEL_LEVEL_LABELS,
  kilometresDriven,
  type TemplateBlock,
  type TemplateDocument,
  type RenterSignature,
} from "@fleetapp/core";

import { loadPdfBranding } from "../contracts/contract-pdf";
import { renderDocumentPdf } from "../contracts/document-pdf";
import type { FileDependencies } from "../files/stored-files";
import type { HandoverView } from "./handover-queries";
import { phoneSignature } from "./phone-signature";
import {
  damagePhotos,
  heading,
  line,
  paragraph,
  printablePhotos,
  type WantedPhoto,
} from "./handover-report";

export const RETURN_REPORT_TITLE = "Return report";
const AT_HANDOVER = " (handover)";
const AT_RETURN = " (return)";

/** What the return report needs beyond its checklist: the handover to compare, and how it ended. */
export interface ReturnReportFacts {
  handover: HandoverView;
  returnedAtText: string;
  acceptanceText: string;
  /** The Renter's signature; none when they were not there. */
  signature: RenterSignature | null;
  /** When the Renter signed, which can differ from when the car came back (review G9-4). */
  signedAtText: string;
}

function fuelText(view: HandoverView): string {
  return view.fuelLevel ? FUEL_LEVEL_LABELS[view.fuelLevel] : "";
}

function damageLines(view: HandoverView, none: string): TemplateBlock[] {
  return view.damageMarks.length === 0
    ? [paragraph(none)]
    : view.damageMarks.map((mark, index) => paragraph(`${index + 1}. ${mark.description}`));
}

/** The report's text: the car then and now, damage already there and new damage, and how it ended. */
function returnDocument(view: HandoverView, facts: ReturnReportFacts): TemplateDocument {
  const driven = kilometresDriven(facts.handover.odometerKm, view.odometerKm);
  return {
    type: "doc",
    content: [
      heading(1, RETURN_REPORT_TITLE),
      line("Renter", view.renterFullName),
      line("Car", `${view.carRego} · ${view.carMakeModel}`),
      line("Returned", facts.returnedAtText),
      heading(2, "Condition"),
      line(
        "Odometer",
        `${formatKilometres(view.odometerKm ?? 0)} (at handover ${formatKilometres(facts.handover.odometerKm ?? 0)}${driven === null ? "" : `, driven ${formatKilometres(driven)}`})`,
      ),
      line("Fuel", `${fuelText(view)} (at handover ${fuelText(facts.handover)})`),
      line("Keys returned", String(view.keysCount ?? "")),
      ...(view.accessories ? [line("Accessories", view.accessories)] : []),
      ...(view.notes ? [line("Notes", view.notes)] : []),
      heading(2, "Damage at handover"),
      ...damageLines(facts.handover, "None marked."),
      heading(2, "New damage at return"),
      ...damageLines(view, "None found."),
      heading(2, facts.signature ? "Accepted by the Renter" : "Recorded by the business"),
      paragraph(facts.acceptanceText),
    ],
  };
}

/**
 * Each photo on the list as a pair, the handover's beside the return's
 * (the report's grid is two across), then the new damage.
 */
function pairedPhotos(view: HandoverView, handover: HandoverView): WantedPhoto[] {
  const pairs = view.photoNames.flatMap((name) => {
    const before = handover.photos.get(name);
    const after = view.photos.get(name);
    return [
      ...(before ? [{ caption: `${name}${AT_HANDOVER}`, photo: before }] : []),
      ...(after ? [{ caption: `${name}${AT_RETURN}`, photo: after }] : []),
    ];
  });
  return [...pairs, ...damagePhotos(view, AT_RETURN)];
}

/** The return report's PDF, signed by the Renter or recorded by the business. */
export async function renderReturnReport(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
  view: HandoverView,
  facts: ReturnReportFacts,
): Promise<Uint8Array> {
  const [branding, photos] = await Promise.all([
    loadPdfBranding(deps, operatorId),
    printablePhotos(deps, operatorId, pairedPhotos(view, facts.handover)),
  ]);
  return renderDocumentPdf({
    ...branding,
    title: `${RETURN_REPORT_TITLE} ${view.carRego}`,
    document: returnDocument(view, facts),
    photos: { heading: "Photos at handover and return", photos },
    signature: facts.signature
      ? phoneSignature(facts.signature, `Accepted by ${view.renterFullName}`, facts.signedAtText)
      : undefined,
  });
}
