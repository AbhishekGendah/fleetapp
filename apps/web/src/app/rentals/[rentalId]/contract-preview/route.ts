import { isRecordId } from "@fleetapp/core";
import { notFound } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { PREVIEW_NOTICE, renderRentalContract } from "../../../../lib/contracts/contract-pdf";
import { pdfResponse } from "../../../../lib/contracts/pdf-response";
import { contractKindOfRental } from "../../../../lib/contracts/signing-links";
import { loadDefaultTemplate } from "../../../../lib/contracts/templates";
import { requireUser } from "../../../../lib/require-user";
import { appFileStorage } from "../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The rental's contract from the default template, filled in, marked as a preview, never issued. */
export async function GET(
  _request: Request,
  props: { params: Promise<{ rentalId: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { rentalId } = await props.params;
  const kind = isRecordId(rentalId)
    ? await contractKindOfRental(appDb, user.operatorId, rentalId)
    : null;
  const template = kind ? await loadDefaultTemplate(appDb, user.operatorId, kind) : null;
  if (!template) {
    notFound();
  }
  const result = await renderRentalContract(
    { database: appDb, storage: appFileStorage },
    user.operatorId,
    { rentalId, title: template.name, template: template.content, notice: PREVIEW_NOTICE },
    { timeZone: user.operatorTimezone, now: new Date() },
  );
  if (!result) {
    notFound();
  }
  return pdfResponse(result.pdf, "Contract (preview).pdf");
}
