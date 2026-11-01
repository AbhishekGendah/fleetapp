import { isRecordId } from "@fleetapp/core";
import { notFound } from "next/navigation";

import { appDb } from "../../../../../lib/app-db";
import { renderTemplatePreview } from "../../../../../lib/contracts/contract-pdf";
import { pdfResponse } from "../../../../../lib/contracts/pdf-response";
import { loadTemplate } from "../../../../../lib/contracts/templates";
import { requireUser } from "../../../../../lib/require-user";
import { appFileStorage } from "../../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The template's latest version as a PDF, each field shown by its name. */
export async function GET(
  _request: Request,
  props: { params: Promise<{ templateId: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { templateId } = await props.params;
  const template = isRecordId(templateId)
    ? await loadTemplate(appDb, user.operatorId, templateId)
    : null;
  if (!template) {
    notFound();
  }
  const pdf = await renderTemplatePreview(
    { database: appDb, storage: appFileStorage },
    user.operatorId,
    { title: template.name, template: template.content },
  );
  return pdfResponse(pdf, `${template.name} (preview).pdf`);
}
