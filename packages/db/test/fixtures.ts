import { randomUUID } from "node:crypto";

import * as schema from "../src/schema";
import type { TestDatabase } from "../src/testing/connect";

export { connectAs, type TestConnection } from "../src/testing";

export interface SeededOperators {
  operatorAId: string;
  operatorBId: string;
}

/**
 * Seeds two Operators with a User each, through the Admin role.
 *
 * Seeding deliberately does not use the owner role: row-level security is
 * forced, so the owner has no policy and would see and write nothing — which
 * is the point of forcing it.
 */
export async function seedTwoOperators(adminDb: TestDatabase): Promise<SeededOperators> {
  const [operatorA] = await adminDb
    .insert(schema.operators)
    .values({ legalName: "Operator A Pty Ltd" })
    .returning({ id: schema.operators.id });
  const [operatorB] = await adminDb
    .insert(schema.operators)
    .values({ legalName: "Operator B Pty Ltd" })
    .returning({ id: schema.operators.id });

  if (!operatorA || !operatorB) {
    throw new Error("Seeding failed: the Admin role could not insert Operators.");
  }

  // Unique per call: User emails are unique platform-wide, and test files run
  // in parallel against the one database.
  await adminDb.insert(schema.users).values([
    { operatorId: operatorA.id, email: `${randomUUID()}@example.test`, fullName: "User A" },
    { operatorId: operatorB.id, email: `${randomUUID()}@example.test`, fullName: "User B" },
  ]);

  await adminDb.insert(schema.activityLog).values([
    {
      operatorId: operatorA.id,
      actorType: "admin",
      entityType: "operator",
      entityId: operatorA.id,
      action: "created",
    },
    {
      operatorId: operatorB.id,
      actorType: "admin",
      entityType: "operator",
      entityId: operatorB.id,
      action: "created",
    },
  ]);

  return { operatorAId: operatorA.id, operatorBId: operatorB.id };
}

/**
 * Postgres SQLSTATE codes the tenancy tests assert on. Matching the code
 * rather than the message proves the database refused for the reason we
 * intended, not merely that something went wrong.
 */
export const POSTGRES_ERROR_CODES = {
  /** No grant, or a row-level security policy refused the row. */
  insufficientPrivilege: "42501",
  /** Raised by the append-only trigger. */
  restrictViolation: "23001",
} as const;

function hasErrorCode(value: unknown): value is { code: string } {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "code") === "string"
  );
}

/**
 * Drizzle wraps driver errors, so the SQLSTATE sits on the cause rather than
 * on the error itself.
 */
export async function postgresErrorCodeOf(action: Promise<unknown>): Promise<string | undefined> {
  try {
    await action;
    return undefined;
  } catch (error) {
    if (hasErrorCode(error)) {
      return error.code;
    }
    if (error instanceof Error && hasErrorCode(error.cause)) {
      return error.cause.code;
    }
    throw error;
  }
}
