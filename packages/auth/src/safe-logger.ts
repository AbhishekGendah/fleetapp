import { describeErrorForLog } from "@fleetapp/core";

/** Better Auth's logging levels. */
type LogLevel = "debug" | "info" | "success" | "warn" | "error";

/** Said in place of a login system error's own words, which can hold the query's values. */
const LOGIN_ERROR_TEXT = "The login system hit an error";

/**
 * Better Auth's logger, made safe (review A2-2). Its error messages repeat
 * the database query with its values (emails, names, live sign-in codes),
 * so an error is logged by its type and code only (rule 7). Other levels
 * are kept to their first line and never carry their extra values.
 */
export const safeAuthLogger = {
  log(level: LogLevel, message: string, ...details: unknown[]): void {
    if (level === "error") {
      const error = details.find((detail): detail is Error => detail instanceof Error);
      console.error(LOGIN_ERROR_TEXT, error ? describeErrorForLog(error) : {});
      return;
    }
    if (level === "warn") {
      console.warn(message.split("\n")[0]);
    }
  },
} as const;
