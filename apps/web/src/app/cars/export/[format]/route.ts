import { exportTable, parseListQuery } from "@fleetapp/core";
import { exportDownload, isExportFormat } from "@fleetapp/core/spreadsheet";
import type { NextRequest } from "next/server";

import { appDb } from "../../../../lib/app-db";
import { requireUser } from "../../../../lib/require-user";
import { listVehiclesForExport } from "../../../../lib/vehicles/vehicle-queries";
import { CAR_LIST } from "../../car-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_STATUS = 404;
const EXPORT_FILE_NAME = "cars";

/** The cars list as CSV or Excel: everything the current search and filters match. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ format: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { format } = await context.params;
  if (!isExportFormat(format)) {
    return new Response(null, { status: NOT_FOUND_STATUS });
  }

  const query = parseListQuery(CAR_LIST, Object.fromEntries(request.nextUrl.searchParams));
  const vehicles = await listVehiclesForExport(appDb, user.operatorId, query);
  return exportDownload(exportTable(CAR_LIST.columns, vehicles), format, EXPORT_FILE_NAME);
}
