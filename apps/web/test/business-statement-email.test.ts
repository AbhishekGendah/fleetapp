import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage } from "@fleetapp/email";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

import * as actingUser from "../src/lib/acting-user";
import type { ActingUser } from "../src/lib/acting-user";
import type { BillingDependencies } from "../src/lib/billing/billing-context";
import {
  issueBusinessStatement,
  listRenterStatements,
} from "../src/lib/billing/business-statements";
import {
  emptyBusinessRenterForm,
  parseBusinessRenterForm,
} from "../src/lib/renters/business-renter-input";
import {
  archiveRenter,
  createBusinessRenter,
  restoreRenter,
} from "../src/lib/renters/renter-records";
import { createMemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { Client } from "pg";

import { seedOperatorWithUser } from "./car-fixtures";
import { openTransactionAs, waitUntilBlockedBy } from "./lock-fixtures";
import { recordingEmailSender } from "./renter-link-fixtures";

/** Set by a test: the next record of a send fails, as a lost connection would. */
const failing = vi.hoisted(() => ({ isNextSendRecordFailing: false }));

vi.mock("../src/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof actingUser>();
  return {
    ...original,
    recordUserChange: (...args: Parameters<typeof original.recordUserChange>) => {
      if (failing.isNextSendRecordFailing) {
        failing.isNextSendRecordFailing = false;
        return Promise.reject(new Error("The connection was lost."));
      }
      return original.recordUserChange(...args);
    },
  };
});

const ALL_DAYS = { fromDate: "2026-10-01", toDate: "2026-11-30" };

/**
 * A business's statement emailed as it is made (review of slice 5): once the
 * statement is issued, a failure emailing it or recording the send never
 * fails the action, so trying again never issues a second version.
 */
describe("emailing a business's statement as it is made", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: Client;
  let actor: ActingUser;
  let businessId: string;
  const sentEmails: EmailMessage[] = [];

  function deps(): BillingDependencies {
    return {
      database: web.db,
      storage: createMemoryFileStorage(),
      emailSender: recordingEmailSender(sentEmails),
      now: () => new Date(),
    };
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = new Client({ connectionString: inject("superuserUrl") });
    await superuser.connect();
    actor = await seedOperatorWithUser(admin, "Statement Email Rentals Pty Ltd");
    const parsed = parseBusinessRenterForm({
      ...emptyBusinessRenterForm(),
      fullName: "Wren Rideshare Pty Ltd",
      abn: "51 824 753 556",
      contactName: "Wendy Wren",
      email: "wendy@wren.example.test",
    });
    businessId = await createBusinessRenter(web.db, actor, parsed.data!);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.end()]);
  });

  it("keeps the statement issued and says it wasn't emailed when the send can't be recorded", async () => {
    failing.isNextSendRecordFailing = true;

    const result = await issueBusinessStatement(deps(), actor, businessId, {
      ...ALL_DAYS,
      isEmailed: true,
    });

    expect(result).toMatchObject({ status: "issued", emailOutcome: "failed" });
    const listed = await listRenterStatements(web.db, actor.operatorId, businessId);
    expect(listed.map((statement) => statement.version)).toEqual([1]);
  });

  it("refuses a statement for an archived business, and makes one once it is restored", async () => {
    expect(await archiveRenter(web.db, actor, businessId)).toBe("changed");

    const refused = await issueBusinessStatement(deps(), actor, businessId, {
      ...ALL_DAYS,
      isEmailed: true,
    });
    await restoreRenter(web.db, actor, businessId);
    const made = await issueBusinessStatement(deps(), actor, businessId, {
      ...ALL_DAYS,
      isEmailed: false,
    });

    expect(refused).toEqual({ status: "not_current" });
    expect(made).toMatchObject({ status: "issued" });
    const versions = (await listRenterStatements(web.db, actor.operatorId, businessId)).map(
      (statement) => statement.version,
    );
    expect(versions).toEqual([2, 1]);
  });

  it("refuses it when the business is archived while the statement waits for its lock", async () => {
    const holder = await openTransactionAs(actor.operatorId);
    let result: Awaited<ReturnType<typeof issueBusinessStatement>>;
    try {
      await holder.client.query(`select id from renters where id = $1 for no key update`, [
        businessId,
      ]);
      const pending = issueBusinessStatement(deps(), actor, businessId, {
        ...ALL_DAYS,
        isEmailed: true,
      });
      await waitUntilBlockedBy(superuser, holder.pid);
      await holder.client.query(`update renters set archived_at = now() where id = $1`, [
        businessId,
      ]);
      await holder.client.query("commit");
      result = await pending;
    } finally {
      await holder.client.end();
    }

    expect(result).toEqual({ status: "not_current" });
    expect(
      (await listRenterStatements(web.db, actor.operatorId, businessId)).map(
        (statement) => statement.version,
      ),
    ).toEqual([2, 1]);
    await restoreRenter(web.db, actor, businessId);
  });
});
