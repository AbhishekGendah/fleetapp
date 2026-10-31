import { randomUUID } from "node:crypto";

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

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Renter links stay within their Operator; a fingerprint finds only a live link. */
describe("Renter links", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let renterBId: string;
  let userBId: string;

  function linkRow(
    operatorId: string,
    changes: Partial<typeof schema.renterLinks.$inferInsert> = {},
  ) {
    return {
      operatorId,
      renterId: renterBId,
      purpose: "details_form" as const,
      tokenHash: randomUUID(),
      sentToEmail: "sam@example.test",
      expiresAt: new Date(Date.now() + 7 * ONE_DAY_MS),
      createdByUserId: userBId,
      ...changes,
    };
  }

  async function lookUp(tokenHash: string) {
    const result = await web.db.execute(
      sql`select operator_id, link_id from app.renter_link_for_token(${tokenHash})`,
    );
    return result.rows;
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    const [user] = await admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.operatorId, operatorBId));
    userBId = user!.id;
    const [renter] = await withTenant(web.db, operatorBId, (tx) =>
      tx
        .insert(schema.renters)
        .values({ operatorId: operatorBId, fullName: "Sam Example", email: "sam@example.test" })
        .returning({ id: schema.renters.id }),
    );
    renterBId = renter!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("finds a live link from its fingerprint, and nothing for an expired or cancelled one", async () => {
    const live = linkRow(operatorBId);
    const [link] = await withTenant(web.db, operatorBId, (tx) =>
      tx.insert(schema.renterLinks).values(live).returning({ id: schema.renterLinks.id }),
    );
    expect(await lookUp(live.tokenHash)).toEqual([{ operator_id: operatorBId, link_id: link!.id }]);
    expect(await lookUp(randomUUID())).toEqual([]);

    await withTenant(web.db, operatorBId, (tx) =>
      tx
        .update(schema.renterLinks)
        .set({ cancelledAt: new Date() })
        .where(eq(schema.renterLinks.id, link!.id)),
    );
    expect(await lookUp(live.tokenHash)).toEqual([]);

    const expired = linkRow(operatorBId, { expiresAt: new Date(Date.now() - 1000) });
    await withTenant(web.db, operatorBId, (tx) => tx.insert(schema.renterLinks).values(expired));
    expect(await lookUp(expired.tokenHash)).toEqual([]);
  });

  it("keeps submissions and link photos to their own Operator, one waiting per Renter", async () => {
    const live = linkRow(operatorBId, { renterId: renterBId });
    const [link] = await withTenant(web.db, operatorBId, async (tx) => {
      await tx
        .update(schema.renterLinks)
        .set({ cancelledAt: new Date() })
        .where(eq(schema.renterLinks.renterId, renterBId));
      return tx.insert(schema.renterLinks).values(live).returning({ id: schema.renterLinks.id });
    });
    const submission = (operatorId: string) => ({
      operatorId,
      renterId: renterBId,
      linkId: link!.id,
      fullName: "Sam Example",
      dateOfBirth: "1998-05-04",
      email: "sam@example.test",
      residentialAddress: "1 Test Street, Perth WA 6000",
      licenceIssuedIn: "WA" as const,
      licenceNumber: "1234567",
      licenceClass: "C" as const,
      licenceType: "full" as const,
      licenceExpiresOn: "2028-05-04",
    });
    const photo = (operatorId: string) => ({
      operatorId,
      purpose: "renter_submitted_scan" as const,
      storageArea: "identity" as const,
      objectKey: `${operatorId}/renter_submitted_scan/${randomUUID()}`,
      contentType: "image/jpeg",
      sizeBytes: 300_000,
      renterLinkId: link!.id,
      licenceSide: "front" as const,
      confirmedAt: new Date(),
    });
    await withTenant(web.db, operatorBId, async (tx) => {
      await tx.insert(schema.renterSubmissions).values(submission(operatorBId));
      await tx.insert(schema.files).values(photo(operatorBId));
    });
    const codes = [
      await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) =>
          tx.insert(schema.renterSubmissions).values(submission(operatorBId)),
        ),
      ),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) => tx.insert(schema.files).values(photo(operatorBId))),
      ),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.insert(schema.renterSubmissions).values(submission(operatorAId)),
        ),
      ),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) =>
          tx.insert(schema.files).values({ ...photo(operatorBId), renterLinkId: null }),
        ),
      ),
      await postgresErrorCodeOf(admin.db.select().from(schema.renterSubmissions)),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) =>
          tx.update(schema.renterSubmissions).set({ fullName: "Changed" }),
        ),
      ),
    ];
    expect(codes).toEqual([
      UNIQUE_VIOLATION,
      UNIQUE_VIOLATION,
      FOREIGN_KEY_VIOLATION,
      CHECK_VIOLATION,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    ]);
  });

  it("allows one live link of a kind per Renter", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) =>
        tx.insert(schema.renterLinks).values(linkRow(operatorBId)),
      ),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("keeps links and phones from other Operators, never deleted, never seen by admin", async () => {
    expect(
      await withTenant(web.db, operatorAId, (tx) => tx.select().from(schema.renterLinks)),
    ).toEqual([]);
    const codes = [
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.insert(schema.renterLinks).values(linkRow(operatorAId)),
        ),
      ),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) => tx.delete(schema.renterLinks)),
      ),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) =>
          tx.update(schema.renterLinks).set({ tokenHash: "x" }),
        ),
      ),
      await postgresErrorCodeOf(admin.db.select().from(schema.renterLinks)),
      await postgresErrorCodeOf(admin.db.select().from(schema.renterLinkDevices)),
      await postgresErrorCodeOf(
        admin.db.execute(sql`select * from app.renter_link_for_token(${"x"})`),
      ),
    ];
    expect(codes).toEqual([
      FOREIGN_KEY_VIOLATION,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    ]);
  });
});
