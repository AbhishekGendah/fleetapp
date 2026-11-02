import {
  formatKilometres,
  FUEL_LEVEL_LABELS,
  type TemplateBlock,
  type TemplateDocument,
} from "@fleetapp/core";
import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray } from "drizzle-orm";

import { loadPdfBranding, loadPdfImage } from "../contracts/contract-pdf";
import { renderDocumentPdf, type PdfPhoto } from "../contracts/document-pdf";
import type { FileDependencies } from "../files/stored-files";
import type { ChecklistPhoto, HandoverView } from "./handover-queries";

export const HANDOVER_REPORT_TITLE = "Handover report";

export const heading = (level: 1 | 2, text: string): TemplateBlock => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
export const paragraph = (text: string): TemplateBlock => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
export const line = (label: string, value: string): TemplateBlock => ({
  type: "paragraph",
  content: [
    { type: "text", text: `${label}: `, marks: [{ type: "bold" }] },
    { type: "text", text: value },
  ],
});

/** The report's text: who, which car, its condition, the damage already on it, and the words accepted. */
function reportDocument(
  view: HandoverView,
  accepted: { atText: string; acceptanceText: string },
): TemplateDocument {
  const damage: TemplateBlock[] =
    view.damageMarks.length === 0
      ? [paragraph("None marked.")]
      : view.damageMarks.map((mark, index) => paragraph(`${index + 1}. ${mark.description}`));
  return {
    type: "doc",
    content: [
      heading(1, HANDOVER_REPORT_TITLE),
      line("Renter", view.renterFullName),
      line("Car", `${view.carRego} · ${view.carMakeModel}`),
      line("Handed over", accepted.atText),
      heading(2, "Condition"),
      line("Odometer", formatKilometres(view.odometerKm ?? 0)),
      line("Fuel", view.fuelLevel ? FUEL_LEVEL_LABELS[view.fuelLevel] : ""),
      line("Keys", String(view.keysCount ?? "")),
      ...(view.accessories ? [line("Accessories", view.accessories)] : []),
      ...(view.notes ? [line("Notes", view.notes)] : []),
      heading(2, "Damage already on the car"),
      ...damage,
      heading(2, "Accepted by the Renter"),
      paragraph(accepted.acceptanceText),
    ],
  };
}

/** A photo to print, with the words under it. */
export interface WantedPhoto {
  caption: string;
  photo: ChecklistPhoto;
}

/** A checklist's photos in list order, then each damage mark's; `suffix` tells two checklists apart. */
export function checklistPhotos(view: HandoverView, suffix = ""): WantedPhoto[] {
  return [
    ...view.photoNames.flatMap((name) => {
      const photo = view.photos.get(name);
      return photo ? [{ caption: `${name}${suffix}`, photo }] : [];
    }),
    ...damagePhotos(view, suffix),
  ];
}

export function damagePhotos(view: HandoverView, suffix = ""): WantedPhoto[] {
  return view.damageMarks.flatMap((mark, index) =>
    mark.photo
      ? [{ caption: `Damage ${index + 1}: ${mark.description}${suffix}`, photo: mark.photo }]
      : [],
  );
}

/** The small copies of the photos, ready for a report (rule 21: each file stored once). */
export async function printablePhotos(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
  wanted: readonly WantedPhoto[],
): Promise<PdfPhoto[]> {
  const fileIds = wanted.map(({ photo }) => photo.thumbnailFileId ?? photo.fileId);
  const stored =
    fileIds.length === 0
      ? []
      : await withTenant(deps.database, operatorId, (tx) =>
          tx
            .select({
              id: files.id,
              storageArea: files.storageArea,
              objectKey: files.objectKey,
              contentType: files.contentType,
            })
            .from(files)
            .where(and(eq(files.operatorId, operatorId), inArray(files.id, fileIds))),
        );
  return Promise.all(
    wanted.map(async ({ caption, photo }) => {
      const file = stored.find((row) => row.id === (photo.thumbnailFileId ?? photo.fileId));
      return {
        caption,
        image: file ? await loadPdfImage(deps.storage, file, "checklist photo") : undefined,
      };
    }),
  );
}

/** The handover report's PDF, with the Renter's signature under the words they accepted. */
export async function renderHandoverReport(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
  view: HandoverView,
  accepted: { atText: string; acceptanceText: string; signaturePng: Uint8Array },
): Promise<Uint8Array> {
  const [branding, photos] = await Promise.all([
    loadPdfBranding(deps, operatorId),
    printablePhotos(deps, operatorId, checklistPhotos(view)),
  ]);
  return renderDocumentPdf({
    ...branding,
    title: `${HANDOVER_REPORT_TITLE} ${view.carRego}`,
    document: reportDocument(view, accepted),
    photos: { heading: "Photos at handover", photos },
    signature: {
      signedByText: `Accepted by ${view.renterFullName}`,
      signedAtText: `Signed on the business's phone on ${accepted.atText}`,
      drawnPng: accepted.signaturePng,
    },
  });
}
