import { randomUUID } from "node:crypto";

import { buildFileKey, STARTER_CONTRACT } from "@fleetapp/core";
import { and, eq } from "drizzle-orm";
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

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const PDF_BYTES = 120_000;
const FINGERPRINT = "a".repeat(64);

/**
 * Contract templates, their versions and issued documents (rule 12): kept
 * to their Operator, the admin app sees none, and what was issued, or the
 * words it was issued from, can never be changed or removed.
 */
describe("contracts", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let userAId: string;
  let rentalAId: string;
  /** Each contract issued for the test rental is its next version. */
  let nextContractVersion = 1;

  async function addTemplate(
    operatorId: string,
    changes: Partial<typeof schema.contractTemplates.$inferInsert> = {},
  ): Promise<string> {
    const [template] = await withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(schema.contractTemplates)
        .values({ operatorId, kind: "contract", name: "Standard contract", ...changes })
        .returning({ id: schema.contractTemplates.id }),
    );
    return template!.id;
  }

  async function addVersion(operatorId: string, templateId: string, version = 1): Promise<string> {
    const [row] = await withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(schema.contractTemplateVersions)
        .values({
          operatorId,
          templateId,
          version,
          content: STARTER_CONTRACT,
          createdByUserId: userAId,
        })
        .returning({ id: schema.contractTemplateVersions.id }),
    );
    return row!.id;
  }

  async function addPdfFile(operatorId: string, isConfirmed = true): Promise<string> {
    const id = randomUUID();
    await withTenant(web.db, operatorId, (tx) =>
      tx.insert(schema.files).values({
        id,
        operatorId,
        purpose: "issued_document",
        storageArea: "general",
        objectKey: buildFileKey(operatorId, "issued_document", id),
        contentType: "application/pdf",
        sizeBytes: PDF_BYTES,
        confirmedAt: isConfirmed ? new Date() : null,
      }),
    );
    return id;
  }

  async function issue(
    changes: Partial<typeof schema.issuedDocuments.$inferInsert> = {},
  ): Promise<string> {
    const templateVersionId = await addVersion(operatorAId, await addTemplate(operatorAId));
    const fileId = await addPdfFile(operatorAId);
    const [document] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.issuedDocuments)
        .values({
          operatorId: operatorAId,
          rentalId: rentalAId,
          kind: "contract",
          version: changes.version ?? nextContractVersion++,
          templateVersionId,
          fileId,
          sha256: FINGERPRINT,
          issuedByUserId: userAId,
          ...changes,
        })
        .returning({ id: schema.issuedDocuments.id }),
    );
    return document!.id;
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
    const [renterId, vehicleId] = await Promise.all([
      addTestRenter(web.db, operatorAId),
      addTestCar(web.db, operatorAId),
    ]);
    const [rental] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(testRentalRow({ operatorId: operatorAId, renterId, vehicleId }))
        .returning({ id: schema.rentals.id }),
    );
    rentalAId = rental!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  describe("kept to their Operator", () => {
    it("hides another Operator's templates, versions and documents", async () => {
      const documentId = await issue();
      const theirTemplate = await addTemplate(operatorBId);

      const seenByB = await withTenant(web.db, operatorBId, async (tx) => ({
        documents: await tx
          .select()
          .from(schema.issuedDocuments)
          .where(eq(schema.issuedDocuments.id, documentId)),
        versions: await tx
          .select()
          .from(schema.contractTemplateVersions)
          .where(eq(schema.contractTemplateVersions.operatorId, operatorAId)),
        templates: await tx
          .select({ operatorId: schema.contractTemplates.operatorId })
          .from(schema.contractTemplates),
      }));

      expect(seenByB.documents).toEqual([]);
      expect(seenByB.versions).toEqual([]);
      expect(seenByB.templates.every((row) => row.operatorId === operatorBId)).toBe(true);
      expect(theirTemplate).toBeTruthy();
    });

    it("refuses a version of another Operator's template, or a document of their rental", async () => {
      const theirTemplate = await addTemplate(operatorBId);
      const theirFile = await addPdfFile(operatorBId);

      const codes = [
        await postgresErrorCodeOf(addVersion(operatorAId, theirTemplate)),
        await postgresErrorCodeOf(
          withTenant(web.db, operatorBId, (tx) =>
            tx.insert(schema.issuedDocuments).values({
              operatorId: operatorBId,
              rentalId: rentalAId,
              kind: "contract",
              version: 1,
              fileId: theirFile,
              sha256: FINGERPRINT,
            }),
          ),
        ),
      ];

      expect(codes).toEqual([FOREIGN_KEY_VIOLATION, FOREIGN_KEY_VIOLATION]);
    });

    it("gives the admin app nothing on templates or documents", async () => {
      const codes = await Promise.all([
        postgresErrorCodeOf(admin.db.select().from(schema.contractTemplates)),
        postgresErrorCodeOf(admin.db.select().from(schema.contractTemplateVersions)),
        postgresErrorCodeOf(admin.db.select().from(schema.issuedDocuments)),
      ]);

      expect(codes).toEqual(codes.map(() => POSTGRES_ERROR_CODES.insufficientPrivilege));
    });
  });

  describe("templates", () => {
    it("allows one default of each kind, so a new rental knows which to use", async () => {
      const owner = (await seedTwoOperators(admin.db)).operatorAId;
      await addTemplate(owner, { isDefault: true });
      await addTemplate(owner, { isDefault: true, kind: "swap_form" });

      const second = await postgresErrorCodeOf(addTemplate(owner, { isDefault: true }));

      expect(second).toBe(UNIQUE_VIOLATION);
    });

    it("numbers versions once each, and never changes one", async () => {
      const templateId = await addTemplate(operatorAId);
      await addVersion(operatorAId, templateId, 1);
      const forVersion = and(
        eq(schema.contractTemplateVersions.templateId, templateId),
        eq(schema.contractTemplateVersions.version, 1),
      );

      const codes = [
        await postgresErrorCodeOf(addVersion(operatorAId, templateId, 1)),
        await postgresErrorCodeOf(
          withTenant(web.db, operatorAId, (tx) =>
            tx
              .update(schema.contractTemplateVersions)
              .set({ content: STARTER_CONTRACT })
              .where(forVersion),
          ),
        ),
        await postgresErrorCodeOf(
          superuser.db.delete(schema.contractTemplateVersions).where(forVersion),
        ),
      ];

      expect(codes).toEqual([
        UNIQUE_VIOLATION,
        POSTGRES_ERROR_CODES.insufficientPrivilege,
        POSTGRES_ERROR_CODES.restrictViolation,
      ]);
    });
  });

  describe("issued documents", () => {
    it("never changes or removes an issued document, even from the database's top login", async () => {
      const documentId = await issue();
      const thisDocument = eq(schema.issuedDocuments.id, documentId);

      const codes = [
        await postgresErrorCodeOf(
          superuser.db
            .update(schema.issuedDocuments)
            .set({ sha256: "b".repeat(64) })
            .where(thisDocument),
        ),
        await postgresErrorCodeOf(superuser.db.delete(schema.issuedDocuments).where(thisDocument)),
      ];

      expect(codes).toEqual([
        POSTGRES_ERROR_CODES.restrictViolation,
        POSTGRES_ERROR_CODES.restrictViolation,
      ]);
    });

    it("keeps an issued document's PDF for good: it can never be binned or swapped", async () => {
      const fileId = await addPdfFile(operatorAId);
      const thisFile = eq(schema.files.id, fileId);

      const codes = [
        await postgresErrorCodeOf(
          withTenant(web.db, operatorAId, (tx) =>
            tx.update(schema.files).set({ deletedAt: new Date() }).where(thisFile),
          ),
        ),
        await postgresErrorCodeOf(
          superuser.db.update(schema.files).set({ objectKey: randomUUID() }).where(thisFile),
        ),
        await postgresErrorCodeOf(superuser.db.delete(schema.files).where(thisFile)),
      ];

      expect(codes).toEqual(codes.map(() => POSTGRES_ERROR_CODES.restrictViolation));
    });

    it("lets a PDF still being saved be cleaned up if saving fails", async () => {
      const fileId = await addPdfFile(operatorAId, false);

      const binned = await withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.files)
          .set({ deletedAt: new Date() })
          .where(eq(schema.files.id, fileId))
          .returning({ id: schema.files.id }),
      );

      expect(binned).toEqual([{ id: fileId }]);
    });

    it("needs a real SHA-256 fingerprint, and numbers each kind's versions once", async () => {
      const badFingerprint = await postgresErrorCodeOf(issue({ sha256: "not-a-fingerprint" }));
      await issue({ kind: "handover_report", version: 1, templateVersionId: null });
      const sameVersion = await postgresErrorCodeOf(
        issue({ kind: "handover_report", version: 1, templateVersionId: null }),
      );

      expect([badFingerprint, sameVersion]).toEqual([CHECK_VIOLATION, UNIQUE_VIOLATION]);
    });
  });
});
