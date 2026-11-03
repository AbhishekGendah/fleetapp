import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
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

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const BOND_CENTS = 500_00;

/** A made-up Stripe ID of a given kind, unique to this run. */
function stripeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/**
 * A Renter's direct debit and payments through Stripe (slice 4): only
 * Stripe's IDs, one active direct debit per Renter, a payment whose status
 * only moves forward and whose bond entry matches it, all kept to its
 * business (rule 1) and away from the admin app (rule 5).
 */
describe("Renter payments", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let renterId: string;
  let rentalId: string;

  function addMandate(values: Partial<typeof schema.paymentMandates.$inferInsert> = {}) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.paymentMandates)
        .values({
          operatorId: operatorAId,
          renterId,
          method: "becs_debit",
          status: "active",
          stripeSetupIntentId: stripeId("seti"),
          stripePaymentMethodId: stripeId("pm"),
          stripeMandateId: stripeId("mandate"),
          ...values,
        })
        .returning({ id: schema.paymentMandates.id }),
    );
  }

  async function addPayment(values: Partial<typeof schema.payments.$inferInsert> = {}) {
    const [payment] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.payments)
        .values({
          operatorId: operatorAId,
          renterId,
          rentalId,
          purpose: "bond",
          method: "card",
          amountCents: BOND_CENTS,
          status: "pending",
          stripeCheckoutSessionId: stripeId("cs_test"),
          stripePaymentIntentId: stripeId("pi"),
          ...values,
        })
        .returning({ id: schema.payments.id }),
    );
    return payment!.id;
  }

  function setPaymentStatus(
    paymentId: string,
    status: "pending" | "succeeded" | "failed" | "refunded",
  ) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.payments)
        .set({ status, settledAt: status === "pending" ? null : new Date() })
        .where(eq(schema.payments.id, paymentId)),
    );
  }

  function addBondFromPayment(paymentId: string, amountCents = BOND_CENTS) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx.insert(schema.bondMovements).values({
        operatorId: operatorAId,
        rentalId,
        kind: "received",
        amountCents,
        method: "card",
        occurredOn: "2026-12-01",
        paymentId,
      }),
    );
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    renterId = await addTestRenter(web.db, operatorAId);
    const vehicleId = await addTestCar(web.db, operatorAId);
    const [rental] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(
          testRentalRow(
            { operatorId: operatorAId, renterId, vehicleId },
            {
              plannedStart: new Date("2026-11-01T01:00:00Z"),
              plannedEnd: new Date("2026-11-20T01:00:00Z"),
            },
          ),
        )
        .returning({ id: schema.rentals.id }),
    );
    rentalId = rental!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  it("keeps one Stripe customer per Renter, by Stripe's ID shape, never changed", async () => {
    const add = (stripeCustomerId: string) =>
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .insert(schema.renterStripeCustomers)
          .values({ operatorId: operatorAId, renterId, stripeCustomerId }),
      );
    await add(stripeId("cus"));
    const codes = [
      await postgresErrorCodeOf(add(stripeId("cus"))),
      await postgresErrorCodeOf(add("a bank account")),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.update(schema.renterStripeCustomers).set({ stripeCustomerId: stripeId("cus") }),
        ),
      ),
    ];
    expect(codes).toEqual([
      UNIQUE_VIOLATION,
      CHECK_VIOLATION,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    ]);
  });

  it("keeps one active direct debit per Renter, BECS only, ended ones with their reason", async () => {
    await addMandate();
    const codes = [
      await postgresErrorCodeOf(addMandate()),
      await postgresErrorCodeOf(addMandate({ status: "waiting", method: "card" })),
      await postgresErrorCodeOf(addMandate({ status: "inactive" })),
      await postgresErrorCodeOf(addMandate({ status: "waiting", stripeMandateId: "1234 5678" })),
    ];
    expect(codes).toEqual([UNIQUE_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION]);
    expect(
      await postgresErrorCodeOf(
        addMandate({ status: "inactive", endReason: "replaced", endedAt: new Date() }),
      ),
    ).toBeUndefined();
  });

  it("moves a payment's status only forward, and never changes its amount", async () => {
    const paymentId = await addPayment();
    const codes = [
      await postgresErrorCodeOf(setPaymentStatus(paymentId, "refunded")),
      await postgresErrorCodeOf(setPaymentStatus(paymentId, "succeeded")),
      await postgresErrorCodeOf(setPaymentStatus(paymentId, "pending")),
      await postgresErrorCodeOf(setPaymentStatus(paymentId, "refunded")),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx
            .update(schema.payments)
            .set({ amountCents: 1 })
            .where(eq(schema.payments.id, paymentId)),
        ),
      ),
      await postgresErrorCodeOf(
        superuser.db.delete(schema.payments).where(eq(schema.payments.id, paymentId)),
      ),
    ];
    expect(codes).toEqual([
      CHECK_VIOLATION,
      undefined,
      CHECK_VIOLATION,
      undefined,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.restrictViolation,
    ]);
  });

  it("puts a payment on the bond once, only once it succeeded, for its exact amount", async () => {
    const pending = await addPayment();
    expect(await postgresErrorCodeOf(addBondFromPayment(pending))).toBe(CHECK_VIOLATION);
    await setPaymentStatus(pending, "succeeded");
    const codes = [
      await postgresErrorCodeOf(addBondFromPayment(pending, BOND_CENTS - 1)),
      await postgresErrorCodeOf(addBondFromPayment(pending)),
      await postgresErrorCodeOf(addBondFromPayment(pending)),
    ];
    expect(codes).toEqual([CHECK_VIOLATION, undefined, UNIQUE_VIOLATION]);
  });

  it("keeps it all to its business, and away from the admin app", async () => {
    await addPayment();
    const seenByB = await withTenant(web.db, operatorBId, async (tx) => [
      ...(await tx.select().from(schema.payments)),
      ...(await tx.select().from(schema.paymentMandates)),
      ...(await tx.select().from(schema.renterStripeCustomers)),
    ]);
    const codes = [
      await postgresErrorCodeOf(admin.db.select().from(schema.payments)),
      await postgresErrorCodeOf(admin.db.select().from(schema.paymentMandates)),
      await postgresErrorCodeOf(admin.db.select().from(schema.renterStripeCustomers)),
      // Operator B cannot put a payment on Operator A's rental.
      await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) =>
          tx.insert(schema.payments).values({
            operatorId: operatorAId,
            renterId,
            rentalId,
            purpose: "bond",
            method: "card",
            amountCents: 1,
            status: "pending",
            stripeCheckoutSessionId: stripeId("cs_test"),
            stripePaymentIntentId: stripeId("pi"),
          }),
        ),
      ),
    ];
    expect(seenByB).toEqual([]);
    expect(codes).toEqual(Array(4).fill(POSTGRES_ERROR_CODES.insufficientPrivilege));
  });
});
