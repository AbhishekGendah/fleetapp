import {
  describeErrorForLog,
  isPictureWithin,
  PDF_PICTURE_LIMITS,
  fillMergeFields,
  MERGE_FIELDS,
  mergeFieldLabel,
  missingMergeFields,
  type ContractData,
  type MergeFieldKey,
  type StorageArea,
  type TemplateDocument,
  operatorDisplayName,
} from "@fleetapp/core";
import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { FileDependencies } from "../files/stored-files";
import type { RentalClock } from "../rentals/rental-records";
import { loadBusinessDetails } from "../settings/business-details";
import { loadContractData } from "./contract-data";
import { renderDocumentPdf, type DocumentPdfInput, type PdfImage } from "./document-pdf";

/** A logo or photo that takes longer than this is left out of the PDF (review G3-7). */
const PDF_IMAGE_TIMEOUT_MS = 15_000;

/** react-pdf prints PNG and JPEG images; a WebP one is left off the PDF. */
/** Whether a stored image's type is one a PDF can hold at all (PNG or JPEG). */
export function isPrintableImageType(contentType: string): boolean {
  return Object.hasOwn(PDF_IMAGE_FORMATS, contentType);
}

const PDF_IMAGE_FORMATS: Readonly<Record<string, PdfImage["format"]>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export const PREVIEW_NOTICE = "Preview: not issued, not for signing";

/** The Operator's logo for a PDF, if it has one react-pdf can print. */
async function loadLogo(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
): Promise<DocumentPdfInput["logo"]> {
  const [logo] = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({
        storageArea: files.storageArea,
        objectKey: files.objectKey,
        contentType: files.contentType,
      })
      .from(files)
      .where(
        and(
          eq(files.operatorId, operatorId),
          eq(files.purpose, "operator_logo"),
          isNotNull(files.confirmedAt),
          isNull(files.deletedAt),
        ),
      ),
  );
  return logo ? loadPdfImage(deps.storage, logo, "logo") : undefined;
}

/**
 * A stored image for a PDF: PNG or JPEG only (react-pdf prints no other),
 * fetched through a short-lived address. Undefined when it cannot be
 * printed or fetched: a PDF without one image beats no PDF.
 */
export async function loadPdfImage(
  storage: FileDependencies["storage"],
  image: { storageArea: StorageArea; objectKey: string; contentType: string },
  describedAs: string,
): Promise<PdfImage | undefined> {
  const format = PDF_IMAGE_FORMATS[image.contentType];
  if (!format) {
    return undefined;
  }
  try {
    const response = await fetch(await storage.createViewUrl(image.storageArea, image.objectKey), {
      signal: AbortSignal.timeout(PDF_IMAGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Logged without details: the address holds the file's key.
      console.error(`Loading the ${describedAs} for a PDF failed`, { status: response.status });
      return undefined;
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (!isPictureWithin(data, PDF_PICTURE_LIMITS)) {
      // A doctored file could freeze the PDF maker for every business (review G5-2).
      console.error(`The ${describedAs} for a PDF was too big to print, so it was left out`);
      return undefined;
    }
    return { data, format };
  } catch (error) {
    console.error(`Loading the ${describedAs} for a PDF failed`, describeErrorForLog(error));
    return undefined;
  }
}

async function businessNameOf(
  database: FileDependencies["database"],
  operatorId: string,
): Promise<string> {
  const business = await loadBusinessDetails(database, operatorId);
  return operatorDisplayName(business);
}

/** The business's name and logo, as every PDF it issues shows them. */
export async function loadPdfBranding(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
): Promise<Pick<DocumentPdfInput, "businessName" | "logo">> {
  const [logo, businessName] = await Promise.all([
    loadLogo(deps, operatorId),
    businessNameOf(deps.database, operatorId),
  ]);
  return { logo, businessName };
}

export interface RentalContractPdf {
  pdf: Uint8Array;
  /** Fields the template uses that have nothing on file for this rental. */
  missing: MergeFieldKey[];
}

/** A template filled in with one rental's details, as a PDF; null if the rental is not the Operator's. */
export async function renderRentalContract(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
  request: { rentalId: string; title: string; template: TemplateDocument; notice?: string },
  clock: RentalClock,
): Promise<RentalContractPdf | null> {
  const data = await loadContractData(deps.database, operatorId, request.rentalId, clock);
  if (!data) {
    return null;
  }
  const pdf = await renderDocumentPdf({
    ...(await loadPdfBranding(deps, operatorId)),
    title: request.title,
    document: fillMergeFields(request.template, data),
    notice: request.notice,
  });
  return { pdf, missing: missingMergeFields(request.template, data) };
}

/** Each field shown by its name, e.g. "[Renter's full name]", for previewing a template on its own. */
const FIELD_NAMES = Object.fromEntries(
  MERGE_FIELDS.map((field) => [field.key, `[${mergeFieldLabel(field.key)}]`]),
) as ContractData;

/** A template as a PDF with each field shown by its name, before any rental uses it. */
export async function renderTemplatePreview(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
  request: { title: string; template: TemplateDocument },
): Promise<Uint8Array> {
  return renderDocumentPdf({
    ...(await loadPdfBranding(deps, operatorId)),
    title: request.title,
    document: fillMergeFields(request.template, FIELD_NAMES),
    notice: PREVIEW_NOTICE,
  });
}
