import { exportTable, parseListQuery, type ListQuery } from "@fleetapp/core";
import { exportDownload, isExportFormat, type ExportFormat } from "@fleetapp/core/spreadsheet";
import type { DataListDefinition } from "@fleetapp/ui/data-list";
import type { NextRequest } from "next/server";

import { requireUser, type SignedInUser } from "./require-user";

const NOT_FOUND_STATUS = 404;

/**
 * A list as CSV or Excel: everything the current search and filters match,
 * with the columns the screen shows. Shared by every list's export route.
 */
export async function listExportResponse<Row>(
  request: NextRequest,
  context: { params: Promise<{ format: string }> },
  list: {
    definition: DataListDefinition<Row>;
    fileName: string;
    loadRows: (user: SignedInUser, query: ListQuery, format: ExportFormat) => Promise<Row[]>;
  },
): Promise<Response> {
  const user = await requireUser();
  const { format } = await context.params;
  if (!isExportFormat(format)) {
    return new Response(null, { status: NOT_FOUND_STATUS });
  }
  const query = parseListQuery(list.definition, Object.fromEntries(request.nextUrl.searchParams));
  const rows = await list.loadRows(user, query, format);
  return exportDownload(exportTable(list.definition.columns, rows), format, list.fileName);
}
