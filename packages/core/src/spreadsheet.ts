import writeXlsxFile, { type SheetData } from "write-excel-file/node";

import type { ExportCell } from "./spreadsheet-cells";

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
