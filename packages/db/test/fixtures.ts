import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
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

/** Adds a car for an Operator through the Operator app's role, with a made-up rego. */
export async function addTestCar(webDb: TestDatabase, operatorId: string): Promise<string> {
  const [car] = await withTenant(webDb, operatorId, (tx) =>
    tx
      .insert(schema.vehicles)
      .values({
        operatorId,
        rego: randomUUID().slice(0, 6).toUpperCase(),
        regoState: "WA",
        make: "Kia",
        model: "Niro",
        year: 2023,
      })
      .returning({ id: schema.vehicles.id }),
  );
  return car!.id;
}

/** Adds a Renter for an Operator through the Operator app's role. */
export async function addTestRenter(webDb: TestDatabase, operatorId: string): Promise<string> {
  const [renter] = await withTenant(webDb, operatorId, (tx) =>
    tx
      .insert(schema.renters)
      .values({ operatorId, fullName: "Sam Example", email: "sam@example.test" })
      .returning({ id: schema.renters.id }),
  );
  return renter!.id;
}

const TEST_RENTAL_CHARGE_WEEKDAY = 2;
const TEST_RENTAL_BOND_CENTS = 50_000;

/** A four-week booking in December 2026 of one Operator's car to one of its Renters. */
export function testRentalRow(
  parties: { operatorId: string; renterId: string; vehicleId: string },
  changes: Partial<typeof schema.rentals.$inferInsert> = {},
): typeof schema.rentals.$inferInsert {
  return {
    ...parties,
    type: "fixed_term",
    status: "booked",
    plannedStart: new Date("2026-12-01T01:00:00Z"),
    plannedEnd: new Date("2026-12-29T01:00:00Z"),
    chargeWeekday: TEST_RENTAL_CHARGE_WEEKDAY,
    bondCents: TEST_RENTAL_BOND_CENTS,
    settingsSnapshot: { minimumRenterAgeYears: 21 },
    settingsVersion: 1,
    ...changes,
  };
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

/** A notice as already emailed and recorded, its date set by the test (its rules skipped). */
export interface TestNotice {
  operatorId: string;
  rentalId: string;
  ledgerLineId: string;
  noticeDate: string;
  partsBefore?: number;
}

/**
 * Gives a one-off charge's plan a notice on the superuser's connection with
 * the rules skipped, so a test can set a notice date that has already come
 * (one recorded through the rules is always at least 3 days ahead).
 */
export async function giveTestNotice(
  superuserDb: TestDatabase,
  notice: TestNotice,
): Promise<string> {
  const id = randomUUID();
  await superuserDb.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    const [plan] = await tx
      .select({
        id: schema.debitPlans.id,
        plan: schema.debitPlans.plan,
        weeks: schema.debitPlans.weeks,
      })
      .from(schema.debitPlans)
      .where(eq(schema.debitPlans.ledgerLineId, notice.ledgerLineId));
    await tx.insert(schema.debitNotices).values({
      id,
      operatorId: notice.operatorId,
      rentalId: notice.rentalId,
      debitPlanId: plan!.id,
      plan: plan!.plan,
      weeks: plan!.weeks,
      noticeDate: notice.noticeDate,
      partsBefore: notice.partsBefore ?? 0,
      emailedAt: new Date(),
      issuedDocumentId: randomUUID(),
    });
    await tx
      .update(schema.debitPlans)
      .set({ noticeId: id })
      .where(eq(schema.debitPlans.id, plan!.id));
  });
  return id;
}
