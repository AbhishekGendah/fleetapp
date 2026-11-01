import { randomUUID } from "node:crypto";

import { STARTER_CONTRACT } from "@fleetapp/core";
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

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FINGERPRINT = "c".repeat(64);

/**
 * Signing links and their evidence: a signing link always names its rental,
 * the template version and the text it was sent for; one is live per
 * rental; the evidence can never be changed and stays with its Operator.
 */
describe("contract signing", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let userAId: string;
  let renterId: string;
  let templateVersionId: string;

  async function addRental(): Promise<string> {
    const vehicleId = await addTestCar(web.db, operatorAId);
    const [rental] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(testRentalRow({ operatorId: operatorAId, renterId, vehicleId }))
        .returning({ id: schema.rentals.id }),
    );
    return rental!.id;
  }

  function signingLink(rentalId: string | null, changes: Record<string, unknown> = {}) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.renterLinks)
        .values({
          operatorId: operatorAId,
          renterId,
          purpose: "sign_contract",
          tokenHash: randomUUID(),
          sentToEmail: "sam@example.test",
          expiresAt: new Date(Date.now() + ONE_WEEK_MS),
          createdByUserId: userAId,
          rentalId,
          templateVersionId: rentalId ? templateVersionId : null,
          contractFingerprint: rentalId ? FINGERPRINT : null,
          ...changes,
        })
        .returning({ id: schema.renterLinks.id }),
    );
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    const [user] = await admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.operatorId, operatorAId));
    userAId = user!.id;
    renterId = await addTestRenter(web.db, operatorAId);
    const [template] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.contractTemplates)
        .values({ operatorId: operatorAId, kind: "contract", name: "Standard" })
        .returning({ id: schema.contractTemplates.id }),
    );
    const [version] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.contractTemplateVersions)
        .values({
          operatorId: operatorAId,
          templateId: template!.id,
          version: 1,
          content: STARTER_CONTRACT,
          createdByUserId: userAId,
        })
        .returning({ id: schema.contractTemplateVersions.id }),
    );
    templateVersionId = version!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  it("needs a signing link to name its rental, template version and text fingerprint", async () => {
    const rentalId = await addRental();

    const codes = [
      await postgresErrorCodeOf(signingLink(null)),
      await postgresErrorCodeOf(signingLink(rentalId, { contractFingerprint: null })),
      await postgresErrorCodeOf(signingLink(rentalId, { contractFingerprint: "short" })),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.insert(schema.renterLinks).values({
            operatorId: operatorAId,
            renterId,
            purpose: "details_form",
            tokenHash: randomUUID(),
            sentToEmail: "sam@example.test",
            expiresAt: new Date(Date.now() + ONE_WEEK_MS),
            createdByUserId: userAId,
            rentalId,
          }),
        ),
      ),
    ];

    expect(codes).toEqual(codes.map(() => CHECK_VIOLATION));
  });

  it("keeps one live signing link per rental, while each rental may have its own", async () => {
    const [first, second] = [await addRental(), await addRental()];
    await signingLink(first);

    const sameRental = await postgresErrorCodeOf(signingLink(first));
    const otherRental = await signingLink(second);

    expect(sameRental).toBe(UNIQUE_VIOLATION);
    expect(otherRental).toHaveLength(1);
  });

  it("never changes or removes evidence, and keeps it from other Operators and the admin app", async () => {
    const rentalId = await addRental();
    const [link] = await signingLink(rentalId);
    const [row] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.signingEvidence)
        .values({
          operatorId: operatorAId,
          linkId: link!.id,
          rentalId,
          step: "contract_viewed",
          ipAddress: "203.0.113.7",
          userAgent: "Example browser",
          details: { contractFingerprint: FINGERPRINT },
        })
        .returning({ id: schema.signingEvidence.id }),
    );
    const thisRow = eq(schema.signingEvidence.id, row!.id);

    const codes = [
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.update(schema.signingEvidence).set({ ipAddress: "x" }).where(thisRow),
        ),
      ),
      await postgresErrorCodeOf(superuser.db.delete(schema.signingEvidence).where(thisRow)),
      await postgresErrorCodeOf(admin.db.select().from(schema.signingEvidence)),
    ];
    const seenByB = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.signingEvidence).where(thisRow),
    );

    expect(codes).toEqual([
      POSTGRES_ERROR_CODES.insufficientPrivilege,
      POSTGRES_ERROR_CODES.restrictViolation,
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    ]);
    expect(seenByB).toEqual([]);
  });
});
