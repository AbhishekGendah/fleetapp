import type { NextRequest } from "next/server";

import { appDb } from "../../../../lib/app-db";
import { listExportResponse } from "../../../../lib/list-export";
import { withExpiryStatuses } from "../../../../lib/vehicles/expiry-columns";
import { loadExpiryContext } from "../../../../lib/vehicles/expiry-context";
import { listVehiclesForExport } from "../../../../lib/vehicles/vehicle-queries";
import { CAR_LIST } from "../../car-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The cars list as CSV or Excel: everything the current search and filters match. */
export function GET(
  request: NextRequest,
  context: { params: Promise<{ format: string }> },
): Promise<Response> {
  return listExportResponse(request, context, {
    definition: CAR_LIST,
    fileName: "cars",
    loadRows: async (user, query) => {
      const [vehicles, expiry] = await Promise.all([
        listVehiclesForExport(appDb, user.operatorId, query),
        loadExpiryContext(user),
      ]);
      return withExpiryStatuses(vehicles, expiry);
    },
  });
}
