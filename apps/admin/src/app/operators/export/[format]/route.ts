import { exportTable, matchingRows, MAX_EXPORT_ROWS, parseListQuery, toCsv } from "@fleetapp/core";
import { toXlsx } from "@fleetapp/core/spreadsheet";
import { NextResponse, type NextRequest } from "next/server";

import { appDb } from "../../../../lib/app-db";
import { listOperators } from "../../../../lib/operators/queries";
import { requireAdmin } from "../../../../lib/require-admin";
import { OPERATOR_LIST } from "../../operator-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_STATUS = 404;
const EXPORT_FILE_NAME = "operators";
const CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

function isExportFormat(format: string): format is keyof typeof CONTENT_TYPES {
  return Object.hasOwn(CONTENT_TYPES, format);
}

/**
 * The Operator list as CSV or Excel: every row the current search and filters
 * match, not just the page shown, built here from the same query.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ format: string }> },
): Promise<NextResponse> {
  await requireAdmin();
  const { format } = await context.params;
  if (!isExportFormat(format)) {
    return new NextResponse(null, { status: NOT_FOUND_STATUS });
  }

  const query = parseListQuery(OPERATOR_LIST, Object.fromEntries(request.nextUrl.searchParams));
  const operators = await listOperators(appDb, new Date());
  const rows = matchingRows(operators, OPERATOR_LIST, query).slice(0, MAX_EXPORT_ROWS);
  const table = exportTable(OPERATOR_LIST.columns, rows);
  const body = format === "csv" ? toCsv(table) : new Uint8Array(await toXlsx(table));

  return new NextResponse(body, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${EXPORT_FILE_NAME}.${format}"`,
      // An export is a snapshot of private data: never kept by a browser or a proxy.
      "Cache-Control": "no-store",
    },
  });
}
