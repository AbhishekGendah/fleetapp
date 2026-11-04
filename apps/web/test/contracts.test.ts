import { STARTER_CONTRACT, type TemplateDocument } from "@fleetapp/core";
import { documentFingerprint } from "@fleetapp/core/server";
import { activityLog, files, issuedDocuments } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { loadContractData } from "../src/lib/contracts/contract-data";
import { renderRentalContract } from "../src/lib/contracts/contract-pdf";
import {
  issueDocument,
  listIssuedDocuments,
  openIssuedDocument,
} from "../src/lib/contracts/issued-documents";
import { templateEditInputSchema } from "../src/lib/contracts/template-input";
import {
  archiveTemplate,
  createTemplate,
  listTemplates,
  loadTemplate,
  makeTemplateDefault,
  saveTemplate,
} from "../src/lib/contracts/templates";
import type { FileDependencies } from "../src/lib/files/stored-files";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { addTestRenter, bookTestRental, TEST_TIME_ZONE } from "./rental-fixtures";

const CLOCK = { timeZone: TEST_TIME_ZONE, now: new Date("2027-05-20T02:00:00Z") };
const PDF_START = "%PDF-";

function editedContract(text: string): TemplateDocument {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] },
      { type: "paragraph", content: [{ type: "mergeField", attrs: { key: "carRego" } }] },
    ],
  };
}

describe("the template editor's rules", () => {
  it("reads the editor's JSON, and refuses what a contract cannot hold", () => {
    const valid = templateEditInputSchema.safeParse({
      name: "Standard",
      content: JSON.stringify(editedContract("Agreement")),
    });
    const notJson = templateEditInputSchema.safeParse({ name: "Standard", content: "{oops" });
    const withLink = templateEditInputSchema.safeParse({
      name: "Standard",
      content: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x", marks: [{ type: "link" }] }],
          },
        ],
      }),
    });

    expect([valid.success, notJson.success, withLink.success]).toEqual([true, false, false]);
  });
});

describe("contract templates and issued documents", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let deps: FileDependencies;
  let actor: ActingUser;
  let otherActor: ActingUser;

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    deps = { database: web.db, storage, now: () => new Date() };
    actor = await seedOperatorWithUser(admin, "Contracts Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Contracts Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  describe("templates", () => {
    it("starts from the starter layout, the first of its kind becoming the default", async () => {
      const owner = await seedOperatorWithUser(admin, "Fresh Contracts Pty Ltd");
      const first = await createTemplate(web.db, owner, { kind: "contract", name: "Standard" });
      const second = await createTemplate(web.db, owner, { kind: "contract", name: "Rideshare" });

      const list = await listTemplates(web.db, owner.operatorId);
      const detail = await loadTemplate(web.db, owner.operatorId, first);

      expect(
        list.map(({ id, isDefault, latestVersion }) => ({ id, isDefault, latestVersion })),
      ).toEqual([
        { id: first, isDefault: true, latestVersion: 1 },
        { id: second, isDefault: false, latestVersion: 1 },
      ]);
      expect(detail?.content).toEqual(STARTER_CONTRACT);
    });

    it("keeps every version: an edit is the next one, and saving the same again does nothing", async () => {
      const templateId = await createTemplate(web.db, actor, { kind: "contract", name: "Std" });
      const content = editedContract("Our agreement");

      const results = [
        await saveTemplate(web.db, actor, templateId, { name: "Std", content }),
        await saveTemplate(web.db, actor, templateId, { name: "Std", content }),
        await saveTemplate(web.db, actor, templateId, { name: "Standard", content }),
      ];
      const detail = await loadTemplate(web.db, actor.operatorId, templateId);

      expect(results).toEqual(["changed", "unchanged", "changed"]);
      expect(detail).toMatchObject({ name: "Standard", latestVersion: 2, content });
      expect(detail?.versions.map((version) => version.version)).toEqual([2, 1]);
    });

    it("moves the default, and never archives the one in use", async () => {
      const owner = await seedOperatorWithUser(admin, "Default Contracts Pty Ltd");
      const first = await createTemplate(web.db, owner, { kind: "contract", name: "A" });
      const second = await createTemplate(web.db, owner, { kind: "contract", name: "B" });

      expect(await archiveTemplate(web.db, owner, first)).toBe("is_default");
      expect(await makeTemplateDefault(web.db, owner, second)).toBe("changed");
      expect(await archiveTemplate(web.db, owner, first)).toBe("changed");
      expect((await listTemplates(web.db, owner.operatorId)).map((row) => row.name)).toEqual(["B"]);
    });

    it("never shows or saves another Operator's template", async () => {
      const templateId = await createTemplate(web.db, actor, { kind: "contract", name: "Mine" });

      expect(await loadTemplate(web.db, otherActor.operatorId, templateId)).toBeNull();
      expect(
        await saveTemplate(web.db, otherActor, templateId, {
          name: "Theirs",
          content: editedContract("x"),
        }),
      ).toBe("not_found");
    });
  });

  describe("a rental's contract", () => {
    it("fills each field from the rental, on the Operator's clock and its own settings", async () => {
      const renterId = await addTestRenter(web, actor, "Rita Contract");
      const { rentalId } = await bookTestRental(web, actor, renterId);

      const data = await loadContractData(web.db, actor.operatorId, rentalId, CLOCK);

      expect(data).toMatchObject({
        businessLegalName: "Contracts Pty Ltd",
        renterFullName: "Rita Contract",
        renterPhone: "0412 345 678",
        renterLicenceNumber: null,
        rentalKind: "Fixed term",
        rentalStart: "1 June 2027, 9:00 am AWST",
        weeklyRate: "$350.00 a week",
        bond: "$500.00",
        chargeDay: "A week at a time in advance, in 24-hour blocks from the handover",
        noticeDays: "7 days",
        insuranceExcess: null,
        issuedOn: "20 May 2027",
      });
      expect(await loadContractData(web.db, otherActor.operatorId, rentalId, CLOCK)).toBeNull();
    });

    it("prints a PDF and says which fields have nothing on file", async () => {
      const renterId = await addTestRenter(web, actor);
      const { rentalId } = await bookTestRental(web, actor, renterId);

      const result = await renderRentalContract(
        deps,
        actor.operatorId,
        { rentalId, title: "Rental contract", template: STARTER_CONTRACT },
        CLOCK,
      );

      expect(new TextDecoder().decode(result?.pdf.slice(0, PDF_START.length))).toBe(PDF_START);
      expect(result?.missing).toEqual(
        expect.arrayContaining(["renterDateOfBirth", "renterLicenceNumber", "insuranceExcess"]),
      );
    });
  });

  describe("issued documents", () => {
    it("stores the PDF once with its fingerprint, numbering each kind's versions", async () => {
      const renterId = await addTestRenter(web, actor);
      const { rentalId } = await bookTestRental(web, actor, renterId);
      const pdf = new TextEncoder().encode("%PDF-1.7 issued example");

      const first = await issueDocument(deps, actor, {
        rentalId,
        kind: "contract",
        templateVersionId: null,
        pdf,
      });
      const second = await issueDocument(deps, actor, {
        rentalId,
        kind: "contract",
        templateVersionId: null,
        pdf,
      });

      expect(first).toMatchObject({
        status: "issued",
        version: 1,
        sha256: documentFingerprint(pdf),
      });
      expect(second).toMatchObject({ status: "issued", version: 2 });
      const [stored] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ objectKey: files.objectKey, confirmedAt: files.confirmedAt })
          .from(issuedDocuments)
          .innerJoin(files, eq(files.id, issuedDocuments.fileId))
          .where(and(eq(issuedDocuments.rentalId, rentalId), eq(issuedDocuments.version, 1))),
      );
      expect(stored?.confirmedAt).not.toBeNull();
      expect(documentFingerprint(storage.read("general", stored!.objectKey)!)).toBe(
        documentFingerprint(pdf),
      );
      expect((await listIssuedDocuments(web.db, actor.operatorId, rentalId)).length).toBe(2);
    });

    it("logs the issue, and never issues for or opens another Operator's rental", async () => {
      const renterId = await addTestRenter(web, actor);
      const { rentalId } = await bookTestRental(web, actor, renterId);
      const pdf = new TextEncoder().encode("%PDF-1.7 another");
      const issued = await issueDocument(deps, actor, {
        rentalId,
        kind: "contract",
        templateVersionId: null,
        pdf,
      });
      const documentId = issued.status === "issued" ? issued.documentId : "";

      const [line] = await withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ action: activityLog.action, actorType: activityLog.actorType })
          .from(activityLog)
          .where(eq(activityLog.entityId, documentId)),
      );
      expect(line).toEqual({ action: "created", actorType: "user" });
      expect(
        await issueDocument(deps, otherActor, {
          rentalId,
          kind: "contract",
          templateVersionId: null,
          pdf,
        }),
      ).toEqual({ status: "not_found" });
      expect(
        await openIssuedDocument(deps, otherActor.operatorId, documentId, "contract.pdf"),
      ).toBeNull();
      expect(await openIssuedDocument(deps, actor.operatorId, documentId, "contract.pdf")).toMatch(
        /^https:\/\/storage\.test\/view\//,
      );
    });
  });
});
