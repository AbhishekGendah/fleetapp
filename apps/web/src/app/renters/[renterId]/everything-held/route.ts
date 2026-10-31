import { isRecordId } from "@fleetapp/core";
import { workbookDownload } from "@fleetapp/core/spreadsheet";
import { notFound } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { buildEverythingHeld } from "../../../../lib/renters/everything-held";
import { requireUser } from "../../../../lib/require-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything held about one Renter as an Excel file, for a Renter who asks (APP 12). Logged. */
export async function GET(
  _request: Request,
  props: { params: Promise<{ renterId: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { renterId } = await props.params;
  if (!isRecordId(renterId)) {
    notFound();
  }
  const workbook = await buildEverythingHeld(
    appDb,
    { userId: user.id, operatorId: user.operatorId },
    renterId,
    user.operatorTimezone,
  );
  if (!workbook) {
    notFound();
  }
  return workbookDownload(workbook.sheets, workbook.fileName);
}
