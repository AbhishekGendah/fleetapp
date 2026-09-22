import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

import * as schema from "../src/schema";
import {
  ADMIN_APP_ROLE,
  ADMIN_APP_UPDATABLE_ADMIN_USER_COLUMNS,
  ADMIN_CREDENTIAL_TABLES,
  WEB_APP_ROLE,
} from "../src/tenancy";
import {
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  type TestConnection,
} from "./fixtures";

/**
 * The point of giving the login system its own database role: a bug anywhere
 * in the ordinary admin app cannot reach a password hash or an authenticator
 * secret, because the connection it runs on has no access to them.
 *
 * These run as the real roles against the real grants, so they fail if anyone
 * widens them.
 */
const credentialTables = sql`(${sql.join(
  ADMIN_CREDENTIAL_TABLES.map((name) => sql`${name}`),
  sql`, `,
)})`;

describe("admin credential isolation", () => {
  let adminApp: TestConnection;
  let adminAuth: TestConnection;
  let web: TestConnection;
  let owner: TestConnection;

  beforeAll(() => {
    adminApp = connectAs(inject("adminRoleUrl"));
    adminAuth = connectAs(inject("adminAuthRoleUrl"));
    web = connectAs(inject("webRoleUrl"));
    owner = connectAs(inject("ownerUrl"));
  });

  afterAll(async () => {
    await Promise.all([adminApp.close(), adminAuth.close(), web.close(), owner.close()]);
  });

  it("keeps the admin app out of every credential table", async () => {
    const result = await owner.db.execute<{ table_name: string; privilege_type: string }>(sql`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN (${ADMIN_APP_ROLE}, ${WEB_APP_ROLE})
        AND table_name IN ${credentialTables}
    `);

    expect(result.rows).toEqual([]);
  });

  it("refuses the admin app a look at password hashes", async () => {
    const code = await postgresErrorCodeOf(adminApp.db.select().from(schema.adminAccounts));

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("refuses the admin app a look at authenticator secrets", async () => {
    const code = await postgresErrorCodeOf(adminApp.db.select().from(schema.adminTwoFactors));

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("refuses the Operator app a look at anything belonging to Admins", async () => {
    const codes = await Promise.all([
      postgresErrorCodeOf(web.db.select().from(schema.adminUsers)),
      postgresErrorCodeOf(web.db.select().from(schema.adminAccounts)),
      postgresErrorCodeOf(web.db.select().from(schema.adminSessions)),
      postgresErrorCodeOf(web.db.select().from(schema.adminTwoFactors)),
      postgresErrorCodeOf(web.db.select().from(schema.adminActivityLog)),
    ]);

    expect(codes).toEqual(codes.map(() => POSTGRES_ERROR_CODES.insufficientPrivilege));
  });

  it("keeps the login system out of Operator data", async () => {
    const codes = await Promise.all([
      postgresErrorCodeOf(adminAuth.db.select().from(schema.operators)),
      postgresErrorCodeOf(adminAuth.db.select().from(schema.users)),
      postgresErrorCodeOf(adminAuth.db.select().from(schema.activityLog)),
    ]);

    expect(codes).toEqual(codes.map(() => POSTGRES_ERROR_CODES.insufficientPrivilege));
  });

  it("lets the login system do its own job", async () => {
    const [admin] = await adminAuth.db
      .insert(schema.adminUsers)
      .values({ email: `${crypto.randomUUID()}@example.test`, fullName: "An Admin" })
      .returning({ id: schema.adminUsers.id });

    expect(admin).toBeDefined();

    await expect(
      adminAuth.db.insert(schema.adminAccounts).values({
        adminUserId: admin!.id,
        accountId: admin!.id,
        providerId: "credential",
        password: "not-a-real-hash",
        updatedAt: new Date(),
      }),
    ).resolves.toBeDefined();
  });

  it("will not let the admin app switch an Admin's second factor off", async () => {
    const result = await owner.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name = 'admin_users'
        AND privilege_type = 'UPDATE'
        AND grantee = ${ADMIN_APP_ROLE}
      ORDER BY column_name
    `);

    // two_factor_enabled and email_verified are deliberately absent: they
    // decide whether an Admin has to present an authenticator code.
    expect(result.rows.map((row) => row.column_name)).toEqual(
      [...ADMIN_APP_UPDATABLE_ADMIN_USER_COLUMNS].sort(),
    );
  });

  it("cannot remove an Admin's credential record", async () => {
    const code = await postgresErrorCodeOf(adminAuth.db.delete(schema.adminAccounts));

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
