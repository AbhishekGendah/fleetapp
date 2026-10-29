import { INVITE_LIFETIME_DAYS, MILLISECONDS_PER_DAY } from "@fleetapp/core";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

const INVITE_LIFETIME_MS = INVITE_LIFETIME_DAYS * MILLISECONDS_PER_DAY;

/**
 * The database's own limits on invites, suspension and the test inbox. These
 * run as the real app roles, so they fail if a later migration loosens them.
 */
describe("operator invites and the test inbox", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let inviteId: string;

  beforeAll(async () => {
    admin = connectAs(inject("adminRoleUrl"));
    web = connectAs(inject("webRoleUrl"));
    ({ operatorAId } = await seedTwoOperators(admin.db));

    const [adminUser] = await admin.db
      .insert(schema.adminUsers)
      .values({ email: `${randomUUID()}@example.test`, fullName: "Inviting Admin" })
      .returning({ id: schema.adminUsers.id });
    const [user] = await admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.operatorId, operatorAId));
    if (!adminUser || !user) {
      throw new Error("Seeding failed: no Admin or User to invite with.");
    }

    const [invite] = await admin.db
      .insert(schema.operatorInvites)
      .values({
        operatorId: operatorAId,
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS),
        createdByAdminId: adminUser.id,
      })
      .returning({ id: schema.operatorInvites.id });
    if (!invite) {
      throw new Error("Seeding failed: the Admin role could not create an invite.");
    }
    inviteId = invite.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("lets the admin app record that an invite was sent, and revoke it", async () => {
    const now = new Date();

    await admin.db
      .update(schema.operatorInvites)
      .set({ sentAt: now, revokedAt: now })
      .where(eq(schema.operatorInvites.id, inviteId));

    const [invite] = await admin.db
      .select()
      .from(schema.operatorInvites)
      .where(eq(schema.operatorInvites.id, inviteId));

    expect(invite?.sentAt).not.toBeNull();
    expect(invite?.revokedAt).not.toBeNull();
  });

  it("does not let the admin app mark an invite accepted", async () => {
    const code = await postgresErrorCodeOf(
      admin.db
        .update(schema.operatorInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.operatorInvites.id, inviteId)),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("does not let the Operator app read invites, even its own", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) => tx.select().from(schema.operatorInvites)),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("does not let an Operator lift its own suspension", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.update(schema.operators).set({ suspendedAt: null }),
      ),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("lets the Operator app add to the test inbox but not read it", async () => {
    await web.db.insert(schema.devEmailOutbox).values({
      toAddress: "someone@example.test",
      fromAddress: "sender@example.test",
      subject: "A test",
      html: "<p>A test</p>",
      text: "A test",
    });

    const code = await postgresErrorCodeOf(web.db.select().from(schema.devEmailOutbox));

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("does not let anyone change an email once it is in the test inbox", async () => {
    const code = await postgresErrorCodeOf(
      admin.db.update(schema.devEmailOutbox).set({ subject: "Rewritten" }),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
