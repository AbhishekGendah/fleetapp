import Papa from "papaparse";

import type { ListColumn, ListValue } from "./list-query";
import { utcToLocalDateTime } from "./local-date-time";

/**
 * One cell of an export. A Date is a wall-clock time already in the
 * reader's timezone (its UTC fields are what they read), since spreadsheet
 * programs show dates without any zone.
 */
export type ExportCell = string | number | Date | null;

/** A moment as the reader's clock showed it then, for a spreadsheet to show as it is. */
function wallClockIn(moment: Date, timeZone: string): Date {
  return new Date(`${utcToLocalDateTime(moment, timeZone)}:00Z`);
}

/**
 * The header row and one row per record, dates in the reader's timezone
 * (rule 10). Text is kept as typed: CSV neutralises it when written, and an
 * Excel text cell can never run as a formula.
 */
export function exportTable<Row>(
  columns: readonly ListColumn<Row>[],
  rows: readonly Row[],
  timeZone: string,
): ExportCell[][] {
  const cell = (value: ListValue): ExportCell =>
    value instanceof Date ? wallClockIn(value, timeZone) : value;
  return [
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => cell(column.exportValue(row)))),
  ];
}

/** Tells Excel the file is UTF-8, so names with accents open correctly. */
const UTF8_BYTE_ORDER_MARK = "\uFEFF";
const CSV_NEWLINE = "\r\n";

/** A wall-clock date as "2026-10-30 14:15", with no zone to mislead. */
function csvDate(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * The table as CSV, written by Papa Parse. Its formula escaping makes text
 * that starts like a formula plain text, so an exported file cannot run one
 * when opened (CSV injection); numbers are left alone.
 */
export function toCsv(table: readonly ExportCell[][]): string {
  const cells = table.map((row) =>
    row.map((value) => (value instanceof Date ? csvDate(value) : value)),
  );
  return UTF8_BYTE_ORDER_MARK + Papa.unparse(cells, { escapeFormulae: true, newline: CSV_NEWLINE });
}
