import type { NextRequest } from "next/server";

import { appDb } from "../../../../lib/app-db";
import { listExportResponse } from "../../../../lib/list-export";
import { carListRows } from "../../../../lib/vehicles/car-list-rows";
import { loadExpiryContext } from "../../../../lib/vehicles/expiry-context";
import { exportVehicles } from "../../../../lib/vehicles/vehicle-queries";
import { CAR_LIST } from "../../car-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The cars list as CSV or Excel: everything the current search and filters match. Each download is logged. */
export function GET(
  request: NextRequest,
  context: { params: Promise<{ format: string }> },
): Promise<Response> {
  return listExportResponse(request, context, {
    definition: CAR_LIST,
    fileName: "cars",
    loadRows: async (user, query, format) => {
      const [vehicles, expiry] = await Promise.all([
        exportVehicles(appDb, { userId: user.id, operatorId: user.operatorId }, query, format),
        loadExpiryContext(user),
      ]);
      return carListRows(vehicles, expiry, { timeZone: user.operatorTimezone, now: new Date() });
    },
  });
}
