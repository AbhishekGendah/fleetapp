import {
  fillMergeFields,
  MERGE_FIELDS,
  mergeFieldLabel,
  missingMergeFields,
  type ContractData,
  type MergeFieldKey,
  type TemplateDocument,
} from "@fleetapp/core";
import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { FileDependencies } from "../files/stored-files";
import type { RentalClock } from "../rentals/rental-records";
import { loadBusinessDetails } from "../settings/business-details";
import { loadContractData } from "./contract-data";
import { renderDocumentPdf, type DocumentPdfInput } from "./document-pdf";

/** react-pdf prints PNG and JPEG logos; a WebP logo is left off the PDF. */
const PDF_LOGO_FORMATS: Readonly<Record<string, "png" | "jpg">> = {
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
  const format = logo ? PDF_LOGO_FORMATS[logo.contentType] : undefined;
  if (!logo || !format) {
    return undefined;
  }
  const response = await fetch(await deps.storage.createViewUrl(logo.storageArea, logo.objectKey));
  if (!response.ok) {
    // A PDF without the logo beats no PDF; the failure is logged without details.
    console.error("Loading the logo for a PDF failed", { status: response.status });
    return undefined;
  }
  return { data: Buffer.from(await response.arrayBuffer()), format };
}

async function businessNameOf(
  database: FileDependencies["database"],
  operatorId: string,
): Promise<string> {
  const business = await loadBusinessDetails(database, operatorId);
  return business?.tradingName ?? business?.legalName ?? "";
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
  const [logo, businessName] = await Promise.all([
    loadLogo(deps, operatorId),
    businessNameOf(deps.database, operatorId),
  ]);
  const pdf = await renderDocumentPdf({
    title: request.title,
    businessName,
    document: fillMergeFields(request.template, data),
    logo,
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
  const [logo, businessName] = await Promise.all([
    loadLogo(deps, operatorId),
    businessNameOf(deps.database, operatorId),
  ]);
  return renderDocumentPdf({
    title: request.title,
    businessName,
    document: fillMergeFields(request.template, FIELD_NAMES),
    logo,
    notice: PREVIEW_NOTICE,
  });
}
