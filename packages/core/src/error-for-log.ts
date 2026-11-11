/** The Postgres error code and constraint, if a database error carries them. */
export interface PostgresErrorFields {
  code?: string;
  constraint?: string;
  /** For a refused permission (42501): which table, function or sequence, e.g. "table files". */
  refusedObject?: string;
}

const PERMISSION_REFUSED_CODE = "42501";
/**
 * Postgres names the object it refused in the message, never a row's values:
 * "permission denied for table x" or "new row violates row-level security
 * policy for table "x"". Only that name is kept.
 */
const REFUSED_OBJECT =
  /^(?:permission denied for (table|function|sequence|schema|view|column)|new row violates row-level security policy for (table)) "?([A-Za-z0-9_.]+)"?/;

function refusedObjectOf(message: string | undefined): string | undefined {
  const match = message ? REFUSED_OBJECT.exec(message) : null;
  if (!match) {
    return undefined;
  }
  const kind = match[1] ?? match[2];
  return `${kind === "table" && match[2] ? "row-level security on table" : kind} ${match[3]}`;
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
  const code = stringField(source, "code");
  return {
    code,
    constraint: stringField(source, "constraint"),
    refusedObject:
      code === PERMISSION_REFUSED_CODE
        ? refusedObjectOf(stringField(source, "message"))
        : undefined,
  };
}

export interface LoggableError extends PostgresErrorFields {
  errorType: string;
}

/**
 * What is safe to write to a log about an error: its kind, and for a database
 * error its code and constraint, and for a refused permission the name of the
 * table, function or sequence refused. Never the message: a database error's message
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
    ...(fields?.refusedObject ? { refusedObject: fields.refusedObject } : {}),
  };
}
