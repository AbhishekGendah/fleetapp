import { contentDisposition, isRecordId } from "@fleetapp/core";
import { toXlsxWorkbook } from "@fleetapp/core/spreadsheet";
import { notFound } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { buildEverythingHeld } from "../../../../lib/renters/everything-held";
import { everythingHeldZip } from "../../../../lib/renters/everything-held-zip";
import { requireUser } from "../../../../lib/require-user";
import { appFileStorage } from "../../../../lib/storage/app-file-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything held about one Renter, for a Renter who asks (APP 12): a zip of
 * the workbook, their documents and licence scans. Logged. Never kept by the
 * browser's cache: it holds identity documents.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ renterId: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { renterId } = await props.params;
  if (!isRecordId(renterId)) {
    notFound();
  }
  const held = await buildEverythingHeld(
    appDb,
    { userId: user.id, operatorId: user.operatorId },
    renterId,
    user.operatorTimezone,
  );
  if (!held) {
    notFound();
  }
  const workbook = new Uint8Array(await toXlsxWorkbook(held.sheets));
  return new Response(everythingHeldZip(held, workbook, appFileStorage), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition("attachment", `${held.fileName}.zip`),
      "Cache-Control": "private, no-store",
    },
  });
}
