import writeXlsxFile, { type SheetData } from "write-excel-file/node";

import { toCsv, type ExportCell } from "./spreadsheet-cells";

/** How dates read in the exported sheet. */
const EXCEL_DATE_FORMAT = "dd/mm/yyyy hh:mm";

/**
 * An Excel file of an export table. Its own import path, not part of the
 * package's index: it is server-only and must never reach a browser bundle.
 */
export async function toXlsx(table: readonly ExportCell[][]): Promise<Buffer> {
  const sheet: SheetData = table.map((row) =>
    row.map((value) =>
      value === null
        ? null
        : value instanceof Date
          ? { type: Date, value, format: EXCEL_DATE_FORMAT }
          : typeof value === "number"
            ? { type: Number, value }
            : { type: String, value },
    ),
  );
  return writeXlsxFile(sheet).toBuffer();
}

const EXPORT_CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export type ExportFormat = keyof typeof EXPORT_CONTENT_TYPES;

export function isExportFormat(format: string): format is ExportFormat {
  return Object.hasOwn(EXPORT_CONTENT_TYPES, format);
}

/** A list export as a file to download, for a route to return as it is. */
export async function exportDownload(
  table: readonly ExportCell[][],
  format: ExportFormat,
  fileName: string,
): Promise<Response> {
  const body = format === "csv" ? toCsv(table) : new Uint8Array(await toXlsx(table));
  return new Response(body, {
    headers: {
      "Content-Type": EXPORT_CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${fileName}.${format}"`,
      // An export is a snapshot of private data: never kept by a browser or a proxy.
      "Cache-Control": "no-store",
    },
  });
}
