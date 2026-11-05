import {
  formatKilometres,
  FUEL_LEVEL_LABELS,
  type TemplateBlock,
  type TemplateDocument,
  type RenterSignature,
} from "@fleetapp/core";
import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray } from "drizzle-orm";

import { loadPdfBranding, loadPdfImage } from "../contracts/contract-pdf";
import { renderDocumentPdf, type PdfPhoto } from "../contracts/document-pdf";
import type { FileDependencies } from "../files/stored-files";
import type { ChecklistPhoto, HandoverView } from "./handover-queries";
import { phoneSignature } from "./phone-signature";

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

/**
 * A checklist photo couldn't be put in the report. Nothing is signed then:
 * a report is the business's record of the car's condition, so a photo is
 * never silently left out (review G9-7).
 */
export class ReportPhotoMissingError extends Error {
  constructor() {
    super("A checklist photo could not be added to the report");
    this.name = "ReportPhotoMissingError";
  }
}

/** What a report's maker answers instead of a PDF when a photo couldn't be added. */
export const PHOTO_MISSING = { status: "photo_missing" } as const;

export function isPhotoMissing(value: unknown): value is typeof PHOTO_MISSING {
  return value === PHOTO_MISSING;
}

/** A report's PDF, or PHOTO_MISSING if one of its photos couldn't be added. */
export async function reportOrPhotoMissing<T>(
  render: () => Promise<T>,
): Promise<T | typeof PHOTO_MISSING> {
  try {
    return await render();
  } catch (error) {
    if (error instanceof ReportPhotoMissingError) {
      return PHOTO_MISSING;
    }
    throw error;
  }
}

/** Tries a photo twice: one dropped fetch on poor signal shouldn't stop a handover. */
async function loadReportPhoto(
  storage: FileDependencies["storage"],
  file: Parameters<typeof loadPdfImage>[1] | undefined,
): Promise<NonNullable<Awaited<ReturnType<typeof loadPdfImage>>>> {
  const image = file
    ? ((await loadPdfImage(storage, file, "checklist photo")) ??
      (await loadPdfImage(storage, file, "checklist photo")))
    : undefined;
  if (!image) {
    throw new ReportPhotoMissingError();
  }
  return image;
}

/**
 * The small copies of the photos, ready for a report (rule 21: each file
 * stored once). Throws ReportPhotoMissingError if any can't be added.
 */
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
      return { caption, image: await loadReportPhoto(deps.storage, file) };
    }),
  );
}

/** The handover report's PDF, with the Renter's signature under the words they accepted. */
export async function renderHandoverReport(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
  view: HandoverView,
  accepted: { atText: string; acceptanceText: string; signature: RenterSignature },
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
    signature: phoneSignature(
      accepted.signature,
      `Accepted by ${view.renterFullName}`,
      accepted.atText,
    ),
  });
}
