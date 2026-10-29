/** The Postgres error code and constraint, if a database error carries them. */
export interface PostgresErrorFields {
  code?: string;
  constraint?: string;
}

function stringField(source: object, name: string): string | undefined {
  const value: unknown = Reflect.get(source, name);
  return typeof value === "string" ? value : undefined;
}

export function postgresFieldsOf(error: unknown): PostgresErrorFields | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  // Drizzle wraps the driver's error, so the Postgres fields sit on its cause.
  const cause: unknown = Reflect.get(error, "cause");
  const source = typeof cause === "object" && cause !== null ? cause : error;
  return { code: stringField(source, "code"), constraint: stringField(source, "constraint") };
}

export interface LoggableError extends PostgresErrorFields {
  errorType: string;
}

/**
 * What is safe to write to a log about an error: its kind, and for a database
 * error its code and constraint. Never the message: a database error's message
 * quotes the values of the query, which can be an address, an email or a
 * password hash (rule 7).
 */
export function describeErrorForLog(error: unknown): LoggableError {
  const errorType = error instanceof Error ? error.name : typeof error;
  const fields = postgresFieldsOf(error);
  return {
    errorType,
    ...(fields?.code ? { code: fields.code } : {}),
    ...(fields?.constraint ? { constraint: fields.constraint } : {}),
  };
}
