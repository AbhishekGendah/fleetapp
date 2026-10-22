const UNIQUE_VIOLATION_CODE = "23505";

interface PostgresErrorFields {
  code?: unknown;
  constraint?: unknown;
}

function postgresFieldsOf(error: unknown): PostgresErrorFields | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  // Drizzle wraps the driver's error, so the Postgres fields sit on its cause.
  const cause: unknown = Reflect.get(error, "cause");
  const source = typeof cause === "object" && cause !== null ? cause : error;
  return { code: Reflect.get(source, "code"), constraint: Reflect.get(source, "constraint") };
}

/** True if Postgres refused a write because it would break this unique index. */
export function isUniqueViolation(error: unknown, indexName: string): boolean {
  const fields = postgresFieldsOf(error);
  return fields?.code === UNIQUE_VIOLATION_CODE && fields.constraint === indexName;
}
