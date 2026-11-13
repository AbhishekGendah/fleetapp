import { postgresFieldsOf } from "./error-for-log";

const UNIQUE_VIOLATION_CODE = "23505";
const EXCLUSION_VIOLATION_CODE = "23P01";
const CHECK_VIOLATION_CODE = "23514";

function isViolation(error: unknown, code: string, constraintName: string): boolean {
  const fields = postgresFieldsOf(error);
  return fields?.code === code && fields.constraint === constraintName;
}

/** True if Postgres refused a write because it would break this unique index. */
export function isUniqueViolation(error: unknown, indexName: string): boolean {
  return isViolation(error, UNIQUE_VIOLATION_CODE, indexName);
}

/** True if Postgres refused a write because it would overlap a row this exclusion rule keeps apart. */
export function isExclusionViolation(error: unknown, constraintName: string): boolean {
  return isViolation(error, EXCLUSION_VIOLATION_CODE, constraintName);
}

/** True if Postgres refused a write by a check (a CHECK constraint or a rule raising check_violation). */
export function isCheckViolation(error: unknown): boolean {
  return postgresFieldsOf(error)?.code === CHECK_VIOLATION_CODE;
}
