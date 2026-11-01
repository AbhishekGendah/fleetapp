import type { ListColumn, ListValue } from "./list-query";
import { utcToLocalDateTime } from "./local-date-time";

/**
 * A cell that starts like a formula is made plain text, so an exported file
 * cannot run a formula when opened (CSV injection). Only text: a negative
 * number stays a number.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutraliseSpreadsheetText(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

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

const CSV_NEEDS_QUOTES = /[",\r\n]/;
/** Tells Excel the file is UTF-8, so names with accents open correctly. */
const UTF8_BYTE_ORDER_MARK = "﻿";

/** A wall-clock date as "2026-10-30 14:15", with no zone to mislead. */
function csvDate(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ");
}

/** Text that starts like a formula is neutralised here, where it could run (CSV injection). */
function csvField(value: ExportCell): string {
  const text =
    value === null
      ? ""
      : value instanceof Date
        ? csvDate(value)
        : typeof value === "string"
          ? neutraliseSpreadsheetText(value)
          : String(value);
  return CSV_NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(table: readonly ExportCell[][]): string {
  return UTF8_BYTE_ORDER_MARK + table.map((row) => row.map(csvField).join(",")).join("\r\n");
}
