import type { ListColumn, ListValue } from "./list-query";

/**
 * A cell that starts like a formula is made plain text, so an exported file
 * cannot run a formula when opened (CSV injection). Only text: a negative
 * number stays a number.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutraliseSpreadsheetText(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

export type ExportCell = string | number | Date | null;

/** The header row and one row per record, every text cell neutralised. */
export function exportTable<Row>(
  columns: readonly ListColumn<Row>[],
  rows: readonly Row[],
): ExportCell[][] {
  const cell = (value: ListValue): ExportCell =>
    typeof value === "string" ? neutraliseSpreadsheetText(value) : value;
  return [
    columns.map((column) => neutraliseSpreadsheetText(column.label)),
    ...rows.map((row) => columns.map((column) => cell(column.exportValue(row)))),
  ];
}

const CSV_NEEDS_QUOTES = /[",\r\n]/;
/** Tells Excel the file is UTF-8, so names with accents open correctly. */
const UTF8_BYTE_ORDER_MARK = "﻿";

function csvField(value: ExportCell): string {
  const text = value === null ? "" : value instanceof Date ? value.toISOString() : String(value);
  return CSV_NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(table: readonly ExportCell[][]): string {
  return UTF8_BYTE_ORDER_MARK + table.map((row) => row.map(csvField).join(",")).join("\r\n");
}
