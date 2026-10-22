import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  ADMIN_APP_ROLE,
  ADMIN_APP_UPDATABLE_USER_COLUMNS,
  USER_CREDENTIAL_TABLES,
  WEB_APP_ROLE,
  WEB_AUTH_READABLE_OPERATOR_COLUMNS,
  WEB_UPDATABLE_USER_COLUMNS,
} from "../src/tenancy";
import {
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

const credentialTables = sql`(${sql.join(
  USER_CREDENTIAL_TABLES.map((name) => sql`${name}`),
  sql`, `,
)})`;

/**
 * The Operator login system's own role, `web_auth_role`, and the walls around
 * it: the Operator app cannot reach a password hash or authenticator secret,
 * and the login system cannot reach anything a login does not need.
 */
describe("Operator login isolation", () => {
  let web: TestConnection;
  let webAuth: TestConnection;
  let admin: TestConnection;
  let owner: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let userAId: string;

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    webAuth = connectAs(inject("webAuthRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    owner = connectAs(inject("ownerUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));

    const [userA] = await admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.operatorId, operatorAId));
    if (!userA) {
      throw new Error("Seeding failed: no User for Operator A.");
    }
    userAId = userA.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), webAuth.close(), admin.close(), owner.close()]);
  });

  async function createAccount(operatorId: string): Promise<string> {
    const [account] = await webAuth.db
      .insert(schema.userAccounts)
      .values({
        operatorId,
        userId: userAId,
        accountId: userAId,
        providerId: `credential-${randomUUID()}`,
        password: "not-a-real-hash",
        updatedAt: new Date(),
      })
      .returning({ operatorId: schema.userAccounts.operatorId });
    if (!account) {
      throw new Error("The login role could not create an account.");
    }
    return account.operatorId;
  }

  it("keeps the Operator app and the admin app out of every User credential table", async () => {
    const result = await owner.db.execute<{ table_name: string; grantee: string }>(sql`
      SELECT table_name, grantee
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN (${WEB_APP_ROLE}, ${ADMIN_APP_ROLE})
        AND table_name IN ${credentialTables}
    `);

    expect(result.rows).toEqual([]);
  });

  it("refuses the Operator app a look at password hashes, even its own", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) => tx.select().from(schema.userAccounts)),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("fills in a login row's Operator from its User", async () => {
    expect(await createAccount(operatorAId)).toBe(operatorAId);
  });

  it("ignores a login row that claims another Operator", async () => {
    expect(await createAccount(operatorBId)).toBe(operatorAId);
  });

  it("lets the Operator app and the admin app change only the User columns they own", async () => {
    const result = await owner.db.execute<{ grantee: string; column_name: string }>(sql`
      SELECT grantee, column_name
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND privilege_type = 'UPDATE'
        AND grantee IN (${WEB_APP_ROLE}, ${ADMIN_APP_ROLE})
      ORDER BY column_name
    `);
    const columnsFor = (role: string) =>
      result.rows.filter((row) => row.grantee === role).map((row) => row.column_name);

    expect(columnsFor(WEB_APP_ROLE)).toEqual([...WEB_UPDATABLE_USER_COLUMNS].sort());
    expect(columnsFor(ADMIN_APP_ROLE)).toEqual([...ADMIN_APP_UPDATABLE_USER_COLUMNS].sort());
  });

  it("does not let the Operator app switch off its own authenticator requirement", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.update(schema.users).set({ twoFactorEnabled: false }),
      ),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("lets the login system read only the Operator columns it needs", async () => {
    const result = await owner.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name = 'operators'
        AND privilege_type = 'SELECT'
        AND grantee = 'web_auth_role'
      ORDER BY column_name
    `);

    expect(result.rows.map((row) => row.column_name)).toEqual(
      [...WEB_AUTH_READABLE_OPERATOR_COLUMNS].sort(),
    );
  });

  it("keeps the login system out of the activity log and everything Admin", async () => {
    const historyCode = await postgresErrorCodeOf(webAuth.db.select().from(schema.activityLog));
    const adminCode = await postgresErrorCodeOf(webAuth.db.select().from(schema.adminUsers));
    const adminPasswordCode = await postgresErrorCodeOf(
      webAuth.db.select().from(schema.adminAccounts),
    );

    expect(historyCode).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    expect(adminCode).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    expect(adminPasswordCode).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("lets the login system mark an invite accepted, but not cancel or resend one", async () => {
    const code = await postgresErrorCodeOf(
      webAuth.db.update(schema.operatorInvites).set({ revokedAt: new Date() }),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
