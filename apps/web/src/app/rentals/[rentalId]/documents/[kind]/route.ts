import { isRecordId } from "@fleetapp/core";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { appDb } from "../../../../../lib/app-db";
import {
  listIssuedDocuments,
  openIssuedDocument,
} from "../../../../../lib/contracts/issued-documents";
import { requireUser } from "../../../../../lib/require-user";
import { appFileStorage } from "../../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The documents a rental's page opens, and the name each downloads as. */
const OPENABLE = {
  contract: "Signed contract.pdf",
  handover_report: "Handover report.pdf",
  return_report: "Return report.pdf",
} as const;
const kindSchema = z.enum(Object.keys(OPENABLE) as [keyof typeof OPENABLE]);

/** The rental's latest document of a kind, through a short-lived address to the stored PDF. */
export async function GET(
  _request: Request,
  props: { params: Promise<{ rentalId: string; kind: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { rentalId, kind } = await props.params;
  const parsedKind = kindSchema.safeParse(kind);
  if (!isRecordId(rentalId) || !parsedKind.success) {
    notFound();
  }
  const documents = await listIssuedDocuments(appDb, user.operatorId, rentalId);
  const latest = documents.find((document) => document.kind === parsedKind.data);
  const url = latest
    ? await openIssuedDocument(
        { database: appDb, storage: appFileStorage },
        user.operatorId,
        latest.id,
        OPENABLE[parsedKind.data],
      )
    : null;
  if (!url) {
    notFound();
  }
  redirect(url);
}
