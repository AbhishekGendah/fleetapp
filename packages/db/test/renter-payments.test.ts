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
const RESTRICT_VIOLATION = "23001";
const UNIQUE_VIOLATION = "23505";
const BOND_CENTS = 500_00;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

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
  let linkId: string;

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
          setUpAt: new Date(),
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
    const [user] = await admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.operatorId, operatorAId));
    const [link] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.renterLinks)
        .values({
          operatorId: operatorAId,
          renterId,
          rentalId,
          purpose: "set_up_payments",
          tokenHash: randomUUID(),
          sentToEmail: "sam@example.test",
          expiresAt: new Date(Date.now() + ONE_DAY_MS),
          createdByUserId: user!.id,
        })
        .returning({ id: schema.renterLinks.id }),
    );
    linkId = link!.id;
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

  function openCheckout(values: Partial<typeof schema.stripeCheckouts.$inferInsert> = {}) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.stripeCheckouts)
        .values({
          operatorId: operatorAId,
          rentalId,
          linkId,
          purpose: "bond",
          amountCents: BOND_CENTS,
          stripeCheckoutSessionId: stripeId("cs_test"),
          url: "https://checkout.stripe.test/pay",
          expiresAt: new Date(Date.now() + ONE_HOUR_MS),
          ...values,
        })
        .returning({ id: schema.stripeCheckouts.id }),
    );
  }

  it("keeps one open Stripe bond page per rental, moving only from open (review KS-1)", async () => {
    const [first] = await openCheckout();
    const codes = [
      await postgresErrorCodeOf(openCheckout()),
      await postgresErrorCodeOf(openCheckout({ purpose: "direct_debit", amountCents: null })),
      await postgresErrorCodeOf(openCheckout({ purpose: "direct_debit" })),
    ];
    expect(codes).toEqual([UNIQUE_VIOLATION, undefined, CHECK_VIOLATION]);

    const setStatus = (status: "open" | "complete" | "expired") =>
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.stripeCheckouts)
          .set({ status })
          .where(eq(schema.stripeCheckouts.id, first!.id)),
      );
    await setStatus("expired");
    expect(await postgresErrorCodeOf(openCheckout())).toBeUndefined();
    const changes = [
      await postgresErrorCodeOf(setStatus("open")),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx
            .update(schema.stripeCheckouts)
            .set({ amountCents: 1 })
            .where(eq(schema.stripeCheckouts.id, first!.id)),
        ),
      ),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.delete(schema.stripeCheckouts).where(eq(schema.stripeCheckouts.id, first!.id)),
        ),
      ),
    ];
    expect(changes).toEqual([
      CHECK_VIOLATION,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    ]);
  });

  it("takes a refund or dispute off a Stripe bond once, never more than was paid (review A5-4)", async () => {
    const paymentId = await addPayment();
    await setPaymentStatus(paymentId, "succeeded");
    await addBondFromPayment(paymentId);
    const takeBack = (stripeObjectId: string | null, amountCents: number) =>
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.bondMovements).values({
          operatorId: operatorAId,
          rentalId,
          kind: "refunded",
          amountCents,
          method: "card",
          occurredOn: "2026-12-02",
          paymentId,
          stripeObjectId,
          stripeObjectKind: stripeObjectId ? "refund" : null,
        }),
      );
    const refundId = stripeId("re");
    const codes = [
      await postgresErrorCodeOf(takeBack(refundId, 100_00)),
      await postgresErrorCodeOf(takeBack(refundId, 100_00)),
      await postgresErrorCodeOf(takeBack(stripeId("re"), BOND_CENTS + 1)),
      await postgresErrorCodeOf(takeBack(null, 100_00)),
      await postgresErrorCodeOf(takeBack("not a Stripe ID", 100_00)),
    ];
    expect(codes).toEqual([
      undefined,
      UNIQUE_VIOLATION,
      CHECK_VIOLATION,
      CHECK_VIOLATION,
      CHECK_VIOLATION,
    ]);
  });

  it("lets only the 'tell Stripe' note on a Renter's Stripe customer change (review A5-6)", async () => {
    const changeCustomer = (change: Partial<typeof schema.renterStripeCustomers.$inferInsert>) =>
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.renterStripeCustomers)
          .set(change)
          .where(eq(schema.renterStripeCustomers.renterId, renterId))
          .returning({ needsUpdate: schema.renterStripeCustomers.needsUpdate }),
      );
    expect(await changeCustomer({ needsUpdate: true })).toEqual([{ needsUpdate: true }]);
    expect(await postgresErrorCodeOf(changeCustomer({ createdAt: new Date() }))).toBe(
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    );
    const viaOwner = await postgresErrorCodeOf(
      superuser.db
        .update(schema.renterStripeCustomers)
        .set({ stripeCustomerId: stripeId("cus") })
        .where(eq(schema.renterStripeCustomers.renterId, renterId)),
    );
    expect(viaOwner).toBe(RESTRICT_VIOLATION);
  });

  it("keeps Stripe pages and link counts to their business, and away from the admin app", async () => {
    await withTenant(web.db, operatorAId, (tx) =>
      tx.insert(schema.renterLinkAttempts).values({
        operatorId: operatorAId,
        linkId,
        action: "stripePages",
        hourStartsAt: new Date("2026-11-04T01:00:00Z"),
      }),
    );
    const seenByB = await withTenant(web.db, operatorBId, async (tx) => [
      ...(await tx.select().from(schema.stripeCheckouts)),
      ...(await tx.select().from(schema.renterLinkAttempts)),
    ]);
    const codes = [
      await postgresErrorCodeOf(admin.db.select().from(schema.stripeCheckouts)),
      await postgresErrorCodeOf(admin.db.select().from(schema.renterLinkAttempts)),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.insert(schema.renterLinkAttempts).values({
            operatorId: operatorAId,
            linkId,
            action: "anything",
            hourStartsAt: new Date("2026-11-04T02:00:00Z"),
          }),
        ),
      ),
    ];
    expect(seenByB).toEqual([]);
    expect(codes).toEqual([
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      CHECK_VIOLATION,
    ]);
  });
});
