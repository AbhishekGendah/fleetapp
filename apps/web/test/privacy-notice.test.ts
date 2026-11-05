import { activityLog } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage, EmailSender } from "@fleetapp/email";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { sendPrivacyNotice } from "../src/lib/privacy/send-privacy-notice";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter } from "../src/lib/renters/renter-records";
import { seedOperatorWithUser } from "./car-fixtures";
import { recordingEmailSender } from "./renter-link-fixtures";

/** A Renter the business adds itself is emailed the privacy notice (review A5-10). */
describe("the privacy notice for a Renter added at the counter", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherBusiness: ActingUser;
  let sentEmails: EmailMessage[];

  const deps = (emailSender: EmailSender = recordingEmailSender(sentEmails)) => ({
    database: web.db,
    emailSender,
  });

  async function addRenter(owner: ActingUser, email: string): Promise<string> {
    const parsed = parseRenterForm(
      { ...emptyRenterForm(), fullName: "Cora Counter", email, phone: "0412 000 999" },
      "2026-11-05",
    );
    if (!parsed.success) {
      throw new Error("The test Renter's details were refused.");
    }
    return createRenter(web.db, owner, parsed.data);
  }

  const noticeLines = (renterId: string) =>
    withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ action: activityLog.action, valuesAfter: activityLog.valuesAfter })
        .from(activityLog)
        .where(and(eq(activityLog.entityId, renterId), eq(activityLog.action, "sent"))),
    );

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Counter Rentals Pty Ltd");
    otherBusiness = await seedOperatorWithUser(admin, "Other Counter Pty Ltd");
    sentEmails = [];
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("emails it from the business, and the history says it went", async () => {
    const renterId = await addRenter(actor, "cora@example.test");
    sentEmails.length = 0;

    expect(await sendPrivacyNotice(deps(), actor, renterId)).toBe("sent");
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      to: "cora@example.test",
      subject: expect.stringMatching(/looks after your information$/),
    });
    expect(sentEmails[0]?.text).toContain("Postmark");
    expect(await noticeLines(renterId)).toEqual([
      { action: "sent", valuesAfter: { email: "privacy_notice" } },
    ]);
  });

  it("says so when the Renter has no email, or the email can't go", async () => {
    const withoutEmail = await addRenter(actor, "");
    const failing: EmailSender = {
      send: async () => {
        throw new Error("The email service is down");
      },
    };

    expect(await sendPrivacyNotice(deps(), actor, withoutEmail)).toBe("no_email");
    const renterId = await addRenter(actor, "cora.two@example.test");
    expect(await sendPrivacyNotice(deps(failing), actor, renterId)).toBe("not_sent");
    expect(await noticeLines(renterId)).toEqual([]);
  });

  it("never emails another business's Renter", async () => {
    const theirs = await addRenter(otherBusiness, "theirs@example.test");
    sentEmails.length = 0;

    expect(await sendPrivacyNotice(deps(), actor, theirs)).toBe("no_email");
    expect(sentEmails).toEqual([]);
  });
});
