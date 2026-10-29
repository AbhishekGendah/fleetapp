import { exportTable, matchingRows, MAX_EXPORT_ROWS, parseListQuery } from "@fleetapp/core";
import { exportDownload, isExportFormat } from "@fleetapp/core/spreadsheet";
import type { NextRequest } from "next/server";

import { appDb } from "../../../../lib/app-db";
import { listOperators } from "../../../../lib/operators/queries";
import { requireAdmin } from "../../../../lib/require-admin";
import { OPERATOR_LIST, OPERATOR_LIST_RULES } from "../../operator-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_STATUS = 404;
const EXPORT_FILE_NAME = "operators";

/**
 * The Operator list as CSV or Excel: every row the current search and filters
 * match, not just the page shown, built here from the same query.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ format: string }> },
): Promise<Response> {
  await requireAdmin();
  const { format } = await context.params;
  if (!isExportFormat(format)) {
    return new Response(null, { status: NOT_FOUND_STATUS });
  }

  const query = parseListQuery(OPERATOR_LIST, Object.fromEntries(request.nextUrl.searchParams));
  const operators = await listOperators(appDb, new Date());
  const rows = matchingRows(operators, OPERATOR_LIST_RULES, query).slice(0, MAX_EXPORT_ROWS);
  return exportDownload(exportTable(OPERATOR_LIST.columns, rows), format, EXPORT_FILE_NAME);
}
