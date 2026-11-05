import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  addTestCar,
  addTestRenter,
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  testRentalRow,
  type TestConnection,
} from "./fixtures";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The admin app's database login does only what its screens do (review
 * A9-3): it names a new business and pauses it, never touches its GST,
 * timezone or Stripe columns, and can't make AGS staff logins. A paused
 * business's payments links keep working; its other links stop.
 */
describe("the admin app's database rights", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId } = await seedTwoOperators(admin.db));
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("names a new business, but can't set anything else on it", async () => {
    const named = await admin.db
      .insert(schema.operators)
      .values({ legalName: `Named ${randomUUID()}`, tradingName: "Named" })
      .returning({ id: schema.operators.id });
    const codes = [
      await postgresErrorCodeOf(
        admin.db.insert(schema.operators).values({ legalName: "GST", gstRegistered: true }),
      ),
      await postgresErrorCodeOf(
        admin.db
          .insert(schema.operators)
          .values({ legalName: "Stripe", stripeAccountId: "acct_123" }),
      ),
    ];
    expect(named).toHaveLength(1);
    expect(codes).toEqual(Array(2).fill(POSTGRES_ERROR_CODES.insufficientPrivilege));
  });

  it("pauses a business, but can't change its GST status, timezone or Stripe columns", async () => {
    const paused = await admin.db
      .update(schema.operators)
      .set({ suspendedAt: new Date() })
      .where(eq(schema.operators.id, operatorAId))
      .returning({ id: schema.operators.id });
    await admin.db
      .update(schema.operators)
      .set({ suspendedAt: null })
      .where(eq(schema.operators.id, operatorAId));
    const codes = [
      await postgresErrorCodeOf(
        admin.db
          .update(schema.operators)
          .set({ gstRegistered: true })
          .where(eq(schema.operators.id, operatorAId)),
      ),
      await postgresErrorCodeOf(
        admin.db
          .update(schema.operators)
          .set({ timezone: "Australia/Sydney" })
          .where(eq(schema.operators.id, operatorAId)),
      ),
      await postgresErrorCodeOf(
        admin.db.insert(schema.adminUsers).values({ email: "fake@example.test", fullName: "Fake" }),
      ),
    ];
    expect(paused).toHaveLength(1);
    expect(codes).toEqual(Array(3).fill(POSTGRES_ERROR_CODES.insufficientPrivilege));
  });

  it("keeps a paused business's payments links working, and stops its others", async () => {
    const renterId = await addTestRenter(web.db, operatorAId);
    const vehicleId = await addTestCar(web.db, operatorAId);
    const [user] = await admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.operatorId, operatorAId));
    const [rental] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(
          testRentalRow(
            { operatorId: operatorAId, renterId, vehicleId },
            {
              plannedStart: new Date("2027-03-01T01:00:00Z"),
              plannedEnd: new Date("2027-03-20T01:00:00Z"),
            },
          ),
        )
        .returning({ id: schema.rentals.id }),
    );
    const addLink = (purpose: "set_up_payments" | "details_form") => {
      const tokenHash = randomUUID();
      return withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.renterLinks).values({
          operatorId: operatorAId,
          renterId,
          rentalId: purpose === "set_up_payments" ? rental!.id : null,
          purpose,
          tokenHash,
          sentToEmail: "sam@example.test",
          expiresAt: new Date(Date.now() + ONE_DAY_MS),
          createdByUserId: user!.id,
        }),
      ).then(() => tokenHash);
    };
    const payments = await addLink("set_up_payments");
    const details = await addLink("details_form");
    const opens = async (tokenHash: string) =>
      (await web.db.execute(sql`select operator_id from app.renter_link_for_token(${tokenHash})`))
        .rows.length === 1;

    await admin.db
      .update(schema.operators)
      .set({ suspendedAt: new Date() })
      .where(eq(schema.operators.id, operatorAId));
    try {
      expect([await opens(payments), await opens(details)]).toEqual([true, false]);
    } finally {
      await admin.db
        .update(schema.operators)
        .set({ suspendedAt: null })
        .where(eq(schema.operators.id, operatorAId));
    }
  });
});
