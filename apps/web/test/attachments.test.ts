import { activityLog, files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import {
  listAttachments,
  openAttachment,
  removeAttachment,
  startAttachmentUpload,
  type AttachmentTarget,
} from "../src/lib/files/attachments";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { parseCostForm, parseSaleForm, emptySaleForm } from "../src/lib/vehicles/cost-input";
import { loadCarCosts } from "../src/lib/vehicles/cost-queries";
import { addCost, saveSale } from "../src/lib/vehicles/cost-records";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";

const PDF_START = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ");
const PDF = { contentType: "application/pdf", sizeBytes: 40_000 };

function parsedOrThrow<Output>(
  result: { success: true; data: Output } | { success: false; error: Error },
): Output {
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

describe("attachments", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let deps: FileDependencies;
  let actor: ActingUser;
  let otherActor: ActingUser;
  let carId: string;
  let costId: string;
  let saleId: string;

  /** Attaches a PDF as the browser would: ask, send to the address given, confirm. */
  async function attach(target: AttachmentTarget): Promise<string> {
    const start = await startAttachmentUpload(deps, actor, target, PDF);
    if (start.status !== "allowed") {
      throw new Error(`The attachment was not allowed: ${start.status}`);
    }
    const permission = storage.permissions.at(-1)!;
    storage.receive(permission.area, permission.key, PDF_START);
    expect(await confirmUpload(deps, actor, start.fileId)).toBe("confirmed");
    return start.fileId;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    deps = { database: web.db, storage, now: () => new Date() };
    actor = await seedOperatorWithUser(admin, "Attach Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Attach Pty Ltd");
    carId = await addTestCar(web, actor, { rego: "ATT1" });
    await addCost(
      web.db,
      actor,
      carId,
      parsedOrThrow(
        parseCostForm({
          incurredOn: "2026-10-30",
          kind: "repair",
          description: "Tyres",
          costCents: "440",
          gstCents: "40",
        }),
      ),
    );
    await saveSale(
      web.db,
      actor,
      carId,
      parsedOrThrow(
        parseSaleForm(
          {
            ...emptySaleForm(),
            soldAt: "2026-10-30T10:00",
            priceCents: "5,000",
            buyerName: "Test Buyer",
            buyerPhone: "0412 345 678",
            buyerAddress: "1 Test St",
          },
          "Australia/Perth",
        ),
      ),
    );
    const costs = await loadCarCosts(web.db, actor.operatorId, carId);
    costId = costs.costs[0]!.id;
    saleId = costs.sale!.id;
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("names and numbers attachments after their record, and keeps sale papers apart", async () => {
    await attach({ kind: "cost", id: costId });
    await attach({ kind: "cost", id: costId });
    await attach({ kind: "sale", id: saleId });
    expect(storage.permissions.at(-1)?.area).toBe("identity");

    const attachments = await listAttachments(web.db, actor.operatorId, { vehicleId: carId });
    expect(attachments.map((attachment) => [attachment.label, attachment.target.kind])).toEqual([
      ["ATT1 Tyres 1", "cost"],
      ["ATT1 Tyres 2", "cost"],
      ["ATT1 sale 1", "sale"],
    ]);
  });

  it("writes every opening of sale papers to the log, but not of a receipt", async () => {
    const receiptId = await attach({ kind: "cost", id: costId });
    const salePapersId = await attach({ kind: "sale", id: saleId });

    expect(await openAttachment(deps, actor, receiptId)).toContain("Tyres");
    expect(await openAttachment(deps, actor, salePapersId)).toContain("identity");
    await openAttachment(deps, actor, salePapersId);

    const viewsOf = (fileId: string) =>
      withTenant(web.db, actor.operatorId, (tx) =>
        tx
          .select({ actorId: activityLog.actorId })
          .from(activityLog)
          .where(and(eq(activityLog.entityId, fileId), eq(activityLog.action, "viewed"))),
      );
    expect(await viewsOf(receiptId)).toEqual([]);
    expect(await viewsOf(salePapersId)).toEqual([
      { actorId: actor.userId },
      { actorId: actor.userId },
    ]);
  });

  it("keeps attachments within their Operator", async () => {
    const receiptId = await attach({ kind: "cost", id: costId });

    expect(
      await startAttachmentUpload(deps, otherActor, { kind: "cost", id: costId }, PDF),
    ).toEqual({
      status: "not_found",
    });
    expect(await openAttachment(deps, otherActor, receiptId)).toBeNull();
    expect(await removeAttachment(deps, otherActor, receiptId)).toBe("not_found");
    expect(await listAttachments(web.db, otherActor.operatorId, { vehicleId: carId })).toEqual([]);

    expect(await removeAttachment(deps, actor, receiptId)).toBe("removed");
    expect(await openAttachment(deps, actor, receiptId)).toBeNull();
    const [row] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select({ deletedAt: files.deletedAt }).from(files).where(eq(files.id, receiptId)),
    );
    expect(row?.deletedAt).not.toBeNull();
  });
});
