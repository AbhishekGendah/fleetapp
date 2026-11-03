import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const ACCOUNT_A = "acct_1TestOperatorA";

/**
 * A business's Stripe account (slice 3): one each, never removed, its own
 * (rule 1), never the admin app's (rule 5); an event's business found only
 * from its account (rule 3); and each event recorded once (rule 20).
 */
describe("Stripe accounts and events", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;

  function connect(operatorId: string, stripeAccountId: string) {
    return withTenant(web.db, operatorId, (tx) =>
      tx.insert(schema.stripeAccounts).values({ operatorId, stripeAccountId, isLive: false }),
    );
  }

  async function operatorFor(accountId: string): Promise<string | null> {
    const result = await web.db.execute(
      sql`SELECT app.operator_for_stripe_account(${accountId}) AS operator_id`,
    );
    return (result.rows[0] as { operator_id: string | null }).operator_id;
  }

  function record(operatorId: string, eventId: string, business: string | null = operatorId) {
    return withTenant(web.db, operatorId, async (tx) => {
      const result = await tx.execute(
        sql`SELECT app.record_stripe_event(${eventId}, 'v2.core.account.updated', ${business}::uuid) AS is_new`,
      );
      return (result.rows[0] as { is_new: boolean }).is_new;
    });
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    await connect(operatorAId, ACCOUNT_A);
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  it("keeps one account per business, each account with one business, and only Stripe's ID shape", async () => {
    const codes = [
      await postgresErrorCodeOf(connect(operatorAId, "acct_1Second")),
      await postgresErrorCodeOf(connect(operatorBId, ACCOUNT_A)),
      await postgresErrorCodeOf(connect(operatorBId, "not-an-account")),
    ];
    expect(codes).toEqual([UNIQUE_VIOLATION, UNIQUE_VIOLATION, CHECK_VIOLATION]);
  });

  it("finds an event's business from its account only", async () => {
    expect(await operatorFor(ACCOUNT_A)).toBe(operatorAId);
    expect(await operatorFor("acct_1NobodysAccount")).toBeNull();
  });

  it("records an event once, and only in its own business's context", async () => {
    expect(await record(operatorAId, "evt_test_once")).toBe(true);
    expect(await record(operatorAId, "evt_test_once")).toBe(false);
    const elsewhere = await postgresErrorCodeOf(record(operatorBId, "evt_test_other", operatorAId));
    expect(elsewhere).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);

    // A failed handling records nothing, so Stripe's retry is handled.
    await withTenant(web.db, operatorAId, async (tx) => {
      await tx.execute(
        sql`SELECT app.record_stripe_event('evt_test_failed', 'v2.core.account.updated', ${operatorAId}::uuid)`,
      );
      throw new Error("Handling failed.");
    }).catch(() => undefined);
    expect(await record(operatorAId, "evt_test_failed")).toBe(true);
  });

  it("keeps the account to its business: never removed, never seen by others or the admin app", async () => {
    const thisAccount = eq(schema.stripeAccounts.operatorId, operatorAId);
    const codes = [
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx
            .update(schema.stripeAccounts)
            .set({ stripeAccountId: "acct_1Swapped" })
            .where(thisAccount),
        ),
      ),
      await postgresErrorCodeOf(superuser.db.delete(schema.stripeAccounts).where(thisAccount)),
      await postgresErrorCodeOf(admin.db.select().from(schema.stripeAccounts)),
      await postgresErrorCodeOf(web.db.select().from(schema.stripeEvents)),
      await postgresErrorCodeOf(admin.db.select().from(schema.stripeEvents)),
    ];
    const seenByB = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.stripeAccounts),
    );

    expect(codes).toEqual([
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.restrictViolation,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    ]);
    expect(seenByB).toEqual([]);
  });
});
