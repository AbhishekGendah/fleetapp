import type { NextRequest } from "next/server";

import { appDb } from "../../../../lib/app-db";
import { listExportResponse } from "../../../../lib/list-export";
import { exportRenters } from "../../../../lib/renters/renter-queries";
import { loadExpiryContext } from "../../../../lib/vehicles/expiry-context";
import { RENTER_LIST, withLicenceStatuses } from "../../renter-list";

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
    loadRows: async (user, query, format) => {
      const [renters, licenceExpiry] = await Promise.all([
        exportRenters(appDb, { userId: user.id, operatorId: user.operatorId }, query, format),
        loadExpiryContext(user, "licenceExpiryWarningDays"),
      ]);
      return withLicenceStatuses(renters, licenceExpiry);
    },
  });
}
