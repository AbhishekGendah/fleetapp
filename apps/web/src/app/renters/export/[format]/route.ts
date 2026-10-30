import type { NextRequest } from "next/server";

import { appDb } from "../../../../lib/app-db";
import { listExportResponse } from "../../../../lib/list-export";
import { exportRenters } from "../../../../lib/renters/renter-queries";
import { RENTER_LIST } from "../../renter-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Renters list as CSV or Excel: what the search and filters match. Each download is logged. */
export function GET(
  request: NextRequest,
  context: { params: Promise<{ format: string }> },
): Promise<Response> {
  return listExportResponse(request, context, {
    definition: RENTER_LIST,
    fileName: "renters",
    loadRows: (user, query, format) =>
      exportRenters(appDb, { userId: user.id, operatorId: user.operatorId }, query, format),
  });
}
