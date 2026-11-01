import { SIGNING_CONSENT_TEXT, type TemplateDocument } from "@fleetapp/core";
import { documentFingerprint } from "@fleetapp/core/server";
import { files, issuedDocuments, renterLinks, signingEvidence } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { loadSigningView, recordSigningEvidence, signContract } from "../src/lib/contracts/signing";
import { loadSigningStatus, sendSigningLink } from "../src/lib/contracts/signing-links";
import { createTemplate, saveTemplate } from "../src/lib/contracts/templates";
import { cancelRental } from "../src/lib/rentals/rental-records";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter, updateRenter } from "../src/lib/renters/renter-records";
import { openLink, type LinkVisit } from "../src/lib/renter-links/link-visits";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { bookTestRental, TEST_TIME_ZONE } from "./rental-fixtures";
import { recordingEmailSender } from "./renter-link-fixtures";

const TOKEN_PATTERN = /\/r\/([A-Za-z0-9_-]+)/;
const META = {
  ipAddress: "203.0.113.9",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};
const RENTER_NAME = "Sam Signer";

/** A short contract using fields every test rental has on file. */
const SHORT_CONTRACT: TemplateDocument = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Agreement" }] },
    {
      type: "paragraph",
      content: [
        { type: "mergeField", attrs: { key: "renterFullName" } },
        { type: "text", text: " rents " },
        { type: "mergeField", attrs: { key: "carRego" } },
        { type: "text", text: " for " },
        { type: "mergeField", attrs: { key: "weeklyRate" } },
        { type: "text", text: " a week." },
      ],
    },
  ],
};

describe("signing a contract through a link", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let sentEmails: EmailMessage[];
  let actor: ActingUser;

  const deps = () => ({
    database: web.db,
    storage,
    emailSender: recordingEmailSender(sentEmails),
    now: () => new Date(),
    appUrl: "https://app.example.test",
    describeDay: () => "Friday 6 November",
  });

  async function addRenterWithEmail(): Promise<string> {
    const parsed = parseRenterForm(
      { ...emptyRenterForm(), fullName: RENTER_NAME, email: "sam.signer@example.test" },
      "2026-10-30",
    );
    return createRenter(web.db, actor, parsed.data!);
  }

  /** Books a car for a new Renter and sends the contract; the opened link as the Renter's phone sees it. */
  async function sentLink(): Promise<{ rentalId: string; renterId: string; visit: LinkVisit }> {
    const renterId = await addRenterWithEmail();
    const { rentalId } = await bookTestRental(web, actor, renterId);
    const result = await sendSigningLink(deps(), actor, rentalId, {
      timeZone: TEST_TIME_ZONE,
      now: new Date(),
    });
    if (result.status !== "sent") {
      throw new Error(`Not sent: ${result.status}`);
    }
    const token = TOKEN_PATTERN.exec(result.url)?.[1] ?? "";
    const visit = await openLink(web.db, token);
    return { rentalId, renterId, visit: visit! };
  }

  function typedSigning(fingerprint: string, changes: Record<string, string> = {}) {
    return {
      areDetailsConfirmed: "on",
      hasConsented: "on",
      method: "typed",
      typedName: RENTER_NAME,
      drawnSignature: "",
      contractFingerprint: fingerprint,
      ...changes,
    };
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    sentEmails = [];
    actor = await seedOperatorWithUser(admin, "Signing Rentals Pty Ltd");
    const templateId = await createTemplate(web.db, actor, { kind: "contract", name: "Short" });
    await saveTemplate(web.db, actor, templateId, { name: "Short", content: SHORT_CONTRACT });
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  describe("sending", () => {
    it("needs a template, and every field it uses on file", async () => {
      const owner = await seedOperatorWithUser(admin, "No Template Pty Ltd");
      const renterId = await createRenter(
        web.db,
        owner,
        parseRenterForm(
          { ...emptyRenterForm(), fullName: "A B", email: "a@example.test" },
          "2026-10-30",
        ).data!,
      );
      const { rentalId } = await bookTestRental(web, owner, renterId);
      const clock = { timeZone: TEST_TIME_ZONE, now: new Date() };

      const withoutTemplate = await sendSigningLink(deps(), owner, rentalId, clock);
      await createTemplate(web.db, owner, { kind: "contract", name: "Starter" });
      const withGaps = await sendSigningLink(deps(), owner, rentalId, clock);

      expect(withoutTemplate).toEqual({ status: "no_template" });
      expect(withGaps.status).toBe("missing");
      expect(withGaps.status === "missing" && withGaps.fields).toContain("renterDateOfBirth");
    });

    it("emails the link from the business, and shows it waiting on the rental", async () => {
      sentEmails.length = 0;
      const { rentalId } = await sentLink();

      const status = await loadSigningStatus(web.db, actor.operatorId, rentalId, new Date());

      expect(sentEmails.at(-1)).toMatchObject({
        to: "sam.signer@example.test",
        subject: "Your rental contract from Signing Rentals Pty Ltd",
      });
      expect(status).toMatchObject({
        signed: null,
        link: { sentToEmail: "sam.signer@example.test" },
      });
    });
  });

  describe("signing", () => {
    it("signs with a typed name: issued for good, evidence kept, link used up, copies emailed", async () => {
      const { rentalId, visit } = await sentLink();
      const view = await loadSigningView(web.db, visit);
      expect(view.status).toBe("ready");
      const fingerprint = view.status === "ready" ? view.fingerprint : "";
      await recordSigningEvidence(web.db, visit, "contract_viewed", META, {
        contractFingerprint: fingerprint,
      });
      sentEmails.length = 0;

      const result = await signContract(deps(), visit, typedSigning(fingerprint), META);

      expect(result.status).toBe("signed");
      const [document] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ sha256: issuedDocuments.sha256, objectKey: files.objectKey })
          .from(issuedDocuments)
          .innerJoin(files, eq(files.id, issuedDocuments.fileId))
          .where(and(eq(issuedDocuments.rentalId, rentalId), eq(issuedDocuments.kind, "contract"))),
      );
      const stored = storage.read("general", document!.objectKey)!;
      expect(documentFingerprint(stored)).toBe(document!.sha256);
      const steps = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({
            step: signingEvidence.step,
            ip: signingEvidence.ipAddress,
            details: signingEvidence.details,
          })
          .from(signingEvidence)
          .where(eq(signingEvidence.linkId, visit.linkId))
          .orderBy(asc(signingEvidence.occurredAt)),
      );
      expect(steps.map((step) => step.step)).toEqual(["contract_viewed", "signed"]);
      expect(steps[1]).toMatchObject({
        ip: META.ipAddress,
        details: { method: "typed", typedName: RENTER_NAME, consentText: SIGNING_CONSENT_TEXT },
      });
      const [link] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ cancelledAt: renterLinks.cancelledAt })
          .from(renterLinks)
          .where(eq(renterLinks.id, visit.linkId)),
      );
      expect(link?.cancelledAt).not.toBeNull();
      expect(sentEmails.map((email) => [email.to, email.attachments?.length])).toEqual([
        ["sam.signer@example.test", 1],
      ]);
      expect(await openLink(web.db, "anything")).toBeNull();
    });

    it("signs only once", async () => {
      const { visit } = await sentLink();
      const view = await loadSigningView(web.db, visit);
      const fingerprint = view.status === "ready" ? view.fingerprint : "";
      await signContract(deps(), visit, typedSigning(fingerprint), META);

      const again = await signContract(deps(), visit, typedSigning(fingerprint), META);

      expect(again).toEqual({ status: "signed_already" });
    });

    it("refuses a typed name that is not the Renter's, and a missing tick", async () => {
      const { visit } = await sentLink();
      const view = await loadSigningView(web.db, visit);
      const fingerprint = view.status === "ready" ? view.fingerprint : "";

      const wrongName = await signContract(
        deps(),
        visit,
        typedSigning(fingerprint, { typedName: "Someone Else" }),
        META,
      );
      const noConsent = await signContract(
        deps(),
        visit,
        typedSigning(fingerprint, { hasConsented: "" }),
        META,
      );

      expect(wrongName).toMatchObject({
        status: "invalid",
        fieldErrors: { typedName: expect.any(Array) },
      });
      expect(noConsent).toMatchObject({
        status: "invalid",
        fieldErrors: { hasConsented: expect.any(Array) },
      });
    });

    it("refuses to sign a contract that changed after the link was sent", async () => {
      const { renterId, visit } = await sentLink();
      const view = await loadSigningView(web.db, visit);
      const fingerprint = view.status === "ready" ? view.fingerprint : "";
      const renamed = parseRenterForm(
        { ...emptyRenterForm(), fullName: "Sam Changed", email: "sam.signer@example.test" },
        "2026-10-30",
      );
      await updateRenter(web.db, actor, renterId, renamed.data!);

      expect((await loadSigningView(web.db, visit)).status).toBe("changed");
      expect(await signContract(deps(), visit, typedSigning(fingerprint), META)).toEqual({
        status: "changed",
      });
    });

    it("refuses the text of an older page, even while the contract is unchanged", async () => {
      const { visit } = await sentLink();

      const result = await signContract(deps(), visit, typedSigning("d".repeat(64)), META);

      expect(result).toEqual({ status: "changed" });
    });

    it("stops the link when the rental is cancelled", async () => {
      const { rentalId, visit } = await sentLink();

      await cancelRental(web.db, actor, rentalId, { reason: "Changed plans" }, new Date());

      const status = await loadSigningStatus(web.db, actor.operatorId, rentalId, new Date());
      expect(status.link).toBeNull();
      expect((await loadSigningView(web.db, visit)).status).toBe("not_signable");
    });
  });
});
