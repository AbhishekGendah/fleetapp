import { postgresFieldsOf } from "@fleetapp/core";

const UNIQUE_VIOLATION_CODE = "23505";

/** True if Postgres refused a write because it would break this unique index. */
export function isUniqueViolation(error: unknown, indexName: string): boolean {
  const fields = postgresFieldsOf(error);
  return fields?.code === UNIQUE_VIOLATION_CODE && fields.constraint === indexName;
}
