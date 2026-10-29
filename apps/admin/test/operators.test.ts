import { randomUUID } from "node:crypto";

import {
  MILLISECONDS_PER_DAY,
  exportTable,
  hashSecretToken,
  matchingRows,
  parseListQuery,
} from "@fleetapp/core";
import {
  activityLog,
  adminUsers,
  devEmailOutbox,
  operatorInvites,
  operators,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { createDevOutboxSender, type EmailMessage, type EmailSender } from "@fleetapp/email";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createOperator } from "../src/lib/operators/create-operator";
import type { OperatorActionDependencies } from "../src/lib/operators/dependencies";
import { EmailAlreadyInUseError, OperatorSuspendedError } from "../src/lib/operators/errors";
import type { CreateOperatorInput } from "../src/lib/operators/operator-input";
import { OPERATOR_LIST, OPERATOR_LIST_RULES } from "../src/app/operators/operator-list";
import { getOperatorDetail, listOperators } from "../src/lib/operators/queries";
import { resendInvite } from "../src/lib/operators/resend-invite";
import { reactivateOperator, suspendOperator } from "../src/lib/operators/suspension";

const APP_URL = "https://app.example.test";
const INVITE_LINK_PATTERN = /https:\/\/app\.example\.test\/invite\/([A-Za-z0-9_-]+)/;
const EIGHT_DAYS_MS = 8 * MILLISECONDS_PER_DAY;

/** Keeps what would have been sent, so a test can open the link in it. */
function createRecordingSender(): EmailSender & { messages: EmailMessage[] } {
  const messages: EmailMessage[] = [];
  return {
    messages,
    async send(message) {
      messages.push(message);
    },
  };
}

const failingSender: EmailSender = {
  async send() {
    throw new Error("The email provider is down.");
  },
};

function tokenFrom(message: EmailMessage | undefined): string {
  const token = message?.text.match(INVITE_LINK_PATTERN)?.[1];
  if (!token) {
    throw new Error("No invite link in the email.");
  }
  return token;
}

function newOperatorInput(): CreateOperatorInput {
  return {
    legalName: `Test Rentals ${randomUUID()} Pty Ltd`,
    tradingName: null,
    userFullName: "Sam Example",
    userEmail: `${randomUUID()}@example.test`,
  };
}

/**
 * The admin app's Operator actions, run as the real admin app role against a
 * real Postgres with the real migrations, so the grants and policies are the
 * ones production has.
 */
describe("Operators and invites", () => {
  let connection: TestConnection;
  let adminUserId: string;
  let sender: ReturnType<typeof createRecordingSender>;
  let deps: OperatorActionDependencies;

  beforeAll(async () => {
    connection = connectAs(inject("operatorsAdminAppRoleUrl"));

    const [admin] = await connection.db
      .insert(adminUsers)
      .values({ email: `${randomUUID()}@example.test`, fullName: "Test Admin" })
      .returning({ id: adminUsers.id });
    if (!admin) {
      throw new Error("Could not create the test Admin.");
    }
    adminUserId = admin.id;

    sender = createRecordingSender();
    deps = { database: connection.db, emailSender: sender, appUrl: APP_URL, now: () => new Date() };
  });

  afterAll(async () => {
    await connection.close();
  });

  async function historyOf(operatorId: string): Promise<string[]> {
    const rows = await connection.db
      .select({ entityType: activityLog.entityType, action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.operatorId, operatorId))
      .orderBy(asc(activityLog.occurredAt));
    return rows.map((row) => `${row.entityType} ${row.action}`);
  }

  describe("creating an Operator", () => {
    it("creates the Operator, its User and an invite, emails the link and logs it all", async () => {
      const input = newOperatorInput();

      const result = await createOperator(deps, adminUserId, input);

      expect(result.isInviteSent).toBe(true);
      const message = sender.messages.at(-1);
      expect(message?.to).toBe(input.userEmail);

      const detail = await getOperatorDetail(connection.db, result.operatorId, new Date());
      expect(detail?.status).toBe("invited");
      expect(detail?.user?.email).toBe(input.userEmail);

      expect(await historyOf(result.operatorId)).toEqual(
        expect.arrayContaining([
          "operator created",
          "user created",
          "operator_invite created",
          "operator_invite sent",
        ]),
      );
    });

    it("stores only the link's fingerprint, never the link", async () => {
      const result = await createOperator(deps, adminUserId, newOperatorInput());
      const token = tokenFrom(sender.messages.at(-1));

      const [invite] = await connection.db
        .select()
        .from(operatorInvites)
        .where(eq(operatorInvites.operatorId, result.operatorId));

      expect(invite?.tokenHash).toBe(hashSecretToken(token));
      expect(JSON.stringify(invite)).not.toContain(token);
    });

    it("refuses an email already in use, and leaves no half-made Operator behind", async () => {
      const input = newOperatorInput();
      await createOperator(deps, adminUserId, input);
      const before = await connection.db.select({ id: operators.id }).from(operators);

      await expect(
        createOperator(deps, adminUserId, { ...newOperatorInput(), userEmail: input.userEmail }),
      ).rejects.toBeInstanceOf(EmailAlreadyInUseError);

      const after = await connection.db.select({ id: operators.id }).from(operators);
      expect(after.length).toBe(before.length);
    });

    it("keeps the Operator when the email fails, with the invite shown as not sent", async () => {
      const result = await createOperator(
        { ...deps, emailSender: failingSender },
        adminUserId,
        newOperatorInput(),
      );

      expect(result.isInviteSent).toBe(false);
      const detail = await getOperatorDetail(connection.db, result.operatorId, new Date());
      expect(detail?.status).toBe("invite_not_sent");
      expect(detail?.invites[0]?.sentAt).toBeNull();
    });

    it("shows an invite as expired once its week is up", async () => {
      const result = await createOperator(deps, adminUserId, newOperatorInput());
      const eightDaysLater = new Date(Date.now() + EIGHT_DAYS_MS);

      const summaries = await listOperators(connection.db, eightDaysLater);

      expect(summaries.find((summary) => summary.id === result.operatorId)?.status).toBe(
        "invite_expired",
      );
    });

    it("searches, filters and exports the list, defusing a name that looks like a formula", async () => {
      const input = {
        ...newOperatorInput(),
        legalName: `=HYPERLINK("http://evil") ${randomUUID()}`,
      };
      const result = await createOperator(deps, adminUserId, input);
      const operators = await listOperators(connection.db, new Date());

      const query = parseListQuery(OPERATOR_LIST, { q: input.userEmail, status: "invited" });
      const rows = matchingRows(operators, OPERATOR_LIST_RULES, query);
      expect(rows.map((row) => row.id)).toEqual([result.operatorId]);

      const [, exported] = exportTable(OPERATOR_LIST.columns, rows);
      expect(String(exported?.[0]).startsWith("'=")).toBe(true);
    });

    it("shows how much each Operator stores, from sizes alone", async () => {
      const result = await createOperator(deps, adminUserId, newOperatorInput());

      const summaries = await listOperators(connection.db, new Date());

      expect(summaries.find((summary) => summary.id === result.operatorId)?.storageUsedBytes).toBe(
        0,
      );
    });
  });

  describe("resending an invite", () => {
    it("cancels the old link and sends a new one", async () => {
      const { operatorId } = await createOperator(deps, adminUserId, newOperatorInput());
      const oldToken = tokenFrom(sender.messages.at(-1));

      const result = await resendInvite(deps, adminUserId, operatorId);
      const newToken = tokenFrom(sender.messages.at(-1));

      expect(result.isInviteSent).toBe(true);
      expect(newToken).not.toBe(oldToken);

      const [oldInvite] = await connection.db
        .select()
        .from(operatorInvites)
        .where(eq(operatorInvites.tokenHash, hashSecretToken(oldToken)));
      const [newInvite] = await connection.db
        .select()
        .from(operatorInvites)
        .where(eq(operatorInvites.tokenHash, hashSecretToken(newToken)));

      expect(oldInvite?.revokedAt).not.toBeNull();
      expect(newInvite?.revokedAt).toBeNull();
      expect(await historyOf(operatorId)).toContain("operator_invite revoked");
    });
  });

  describe("suspending an Operator", () => {
    it("suspends, refuses to resend while suspended, then reactivates", async () => {
      const { operatorId } = await createOperator(deps, adminUserId, newOperatorInput());

      await suspendOperator(deps, adminUserId, operatorId);
      expect((await getOperatorDetail(connection.db, operatorId, new Date()))?.status).toBe(
        "suspended",
      );

      await expect(resendInvite(deps, adminUserId, operatorId)).rejects.toBeInstanceOf(
        OperatorSuspendedError,
      );

      await reactivateOperator(deps, adminUserId, operatorId);
      expect((await getOperatorDetail(connection.db, operatorId, new Date()))?.status).toBe(
        "invited",
      );

      const history = await historyOf(operatorId);
      expect(history).toContain("operator suspended");
      expect(history).toContain("operator reactivated");
    });

    it("logs a double suspension once", async () => {
      const { operatorId } = await createOperator(deps, adminUserId, newOperatorInput());

      await suspendOperator(deps, adminUserId, operatorId);
      await suspendOperator(deps, adminUserId, operatorId);

      const suspensions = await connection.db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(and(eq(activityLog.operatorId, operatorId), eq(activityLog.action, "suspended")));
      expect(suspensions).toHaveLength(1);
    });
  });

  describe("the test inbox", () => {
    it("keeps a sent invite, link and all", async () => {
      const outbox = createDevOutboxSender({
        database: connection.db,
        from: "Sender <sender@example.test>",
      });
      const input = newOperatorInput();

      await createOperator({ ...deps, emailSender: outbox }, adminUserId, input);

      const [email] = await connection.db
        .select()
        .from(devEmailOutbox)
        .where(eq(devEmailOutbox.toAddress, input.userEmail));
      expect(email?.fromAddress).toBe("Sender <sender@example.test>");
      expect(email?.html).toMatch(INVITE_LINK_PATTERN);
    });
  });
});
