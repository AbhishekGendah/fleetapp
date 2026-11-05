import { drawnSignatureInput, type DocumentEmailState } from "@fleetapp/core";
import type { TestConnection } from "@fleetapp/db/testing";
import { connectAs } from "@fleetapp/db/testing";
import type { EmailMessage, EmailSender } from "@fleetapp/email";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { emailDocumentAgain, loadDocumentEmailStates } from "../src/lib/contracts/document-emails";
import { completeHandover } from "../src/lib/handover/complete-handover";
import { createMemoryFileStorage } from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, TEST_SIGNATURE } from "./handover-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

/** A sender whose every send fails, as when the email service is down. */
const FAILING_SENDER: EmailSender = {
  async send() {
    throw new Error("The email service is down");
  },
};

/**
 * Each emailed copy of a fixed document is recorded, the rental page says
 * what really happened, and "Email again" sends the stored PDF once more
 * (review G7-1, G9-9).
 */
describe("emailed copies of fixed documents", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let sentEmails: EmailMessage[];
  let kit: ReturnType<typeof checklistKit>;

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    sentEmails = [];
    actor = await seedOperatorWithUser(admin, "Emailing Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Emailing Rentals Pty Ltd");
    kit = checklistKit(web, createMemoryFileStorage(), sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  /** A handover finished while the email service is down. */
  async function handedOverWithoutEmail(): Promise<string> {
    const { rentalId } = await kit.readyRental();
    const inspectionId = await kit.filledHandover(rentalId);
    const result = await completeHandover(
      { ...kit.handoverDeps(), emailSender: FAILING_SENDER },
      actor,
      inspectionId,
      {
        shownFingerprint: await kit.shown(inspectionId),
        signature: drawnSignatureInput(TEST_SIGNATURE),
        bondOverrideReason: null,
        directDebitOverrideReason: null,
        insuranceOverrideReason: null,
        regoOverrideReason: null,
      },
      { timeZone: TEST_TIME_ZONE, now: new Date() },
    );
    // The car is handed over for good: a failed email never says otherwise.
    expect(result.status).toBe("completed");
    return result.status === "completed" ? result.documentId : "";
  }

  const stateOf = async (documentId: string): Promise<DocumentEmailState | undefined> =>
    (await loadDocumentEmailStates(web.db, actor.operatorId, [documentId])).get(documentId);

  it("records a copy that didn't go, and the business has no email to send to", async () => {
    const documentId = await handedOverWithoutEmail();

    expect(await stateOf(documentId)).toEqual({ renter: "failed", business: "no_address" });
  });

  it("sends the stored PDF again, and records that it went", async () => {
    const documentId = await handedOverWithoutEmail();
    sentEmails.length = 0;

    const result = await emailDocumentAgain(kit.handoverDeps(), actor, documentId, TEST_TIME_ZONE);

    expect(result).toMatchObject({ status: "sent", state: { renter: "sent" } });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.attachments?.[0]?.content).toBeDefined();
    expect(await stateOf(documentId)).toEqual({ renter: "sent", business: "no_address" });

    // Pressed again from an old page: what went already is not sent twice.
    sentEmails.length = 0;
    await emailDocumentAgain(kit.handoverDeps(), actor, documentId, TEST_TIME_ZONE);
    expect(sentEmails).toHaveLength(0);
  });

  it("never sends or shows another Operator's document", async () => {
    const documentId = await handedOverWithoutEmail();

    const result = await emailDocumentAgain(
      kit.handoverDeps(),
      otherOperator,
      documentId,
      TEST_TIME_ZONE,
    );
    const seen = await loadDocumentEmailStates(web.db, otherOperator.operatorId, [documentId]);

    expect(result).toEqual({ status: "not_found" });
    expect(seen.get(documentId)).toEqual({ renter: null, business: null });
  });
});
