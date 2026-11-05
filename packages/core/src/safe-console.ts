import { describeErrorForLog } from "./error-for-log";

/** Where a database error starts repeating the query's values (Drizzle's wording). */
const QUERY_VALUES_MARKER = "params:";

/** One logged value made safe: an error by its type and code only, a query's values cut off. */
function safeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return describeErrorForLog(value);
  }
  if (typeof value === "string" && value.includes(QUERY_VALUES_MARKER)) {
    return `${value.slice(0, value.indexOf(QUERY_VALUES_MARKER))}[values withheld]`;
  }
  return value;
}

let isInstalled = false;

/**
 * Makes every server error and warning log safe (review A7-1). Next.js logs
 * a page or button that fails with the error itself, and a database error
 * repeats the query's values: Renters' names, phones, emails and licence
 * numbers would land in the hosting logs (rule 7). Installed once, at
 * start-up, by each app.
 */
export function installSafeErrorLogging(): void {
  if (isInstalled) {
    return;
  }
  isInstalled = true;
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  console.error = (...values: unknown[]) => originalError(...values.map(safeLogValue));
  console.warn = (...values: unknown[]) => originalWarn(...values.map(safeLogValue));
}
