import { randomUUID } from "node:crypto";

import { buildFileKey, type FilePurpose } from "@fleetapp/core";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  addTestCar,
  connectAs,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

function carFileRow(
  operatorId: string,
  purpose: FilePurpose,
  links: {
    vehicleId?: string;
    label?: string;
    thumbnailOfFileId?: string;
    costId?: string;
    saleId?: string;
    policyId?: string;
  },
) {
  const id = randomUUID();
  return {
    id,
    operatorId,
    purpose,
    storageArea: "general" as "general" | "identity",
    objectKey: buildFileKey(operatorId, purpose, id),
    contentType: "image/jpeg",
    sizeBytes: 1000,
    ...links,
  };
}

/** A car's photos and documents point only at that Operator's car and photos. */
describe("car photos and documents", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let carAId: string;
  let carBId: string;
  let photoBId: string;

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    carAId = await addTestCar(web.db, operatorAId);
    carBId = await addTestCar(web.db, operatorBId);
    const photoB = carFileRow(operatorBId, "vehicle_photo", {
      vehicleId: carBId,
      label: "B 2026-10-30 001",
    });
    photoBId = photoB.id;
    await withTenant(web.db, operatorBId, (tx) => tx.insert(schema.files).values(photoB));
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("refuses a file on another Operator's car, or a small copy of another Operator's photo", async () => {
    const attempts = [
      carFileRow(operatorAId, "vehicle_photo", { vehicleId: carBId, label: "A 2026-10-30 001" }),
      carFileRow(operatorAId, "vehicle_photo_thumbnail", {
        vehicleId: carAId,
        thumbnailOfFileId: photoBId,
      }),
    ];
    for (const row of attempts) {
      const code = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) => tx.insert(schema.files).values(row)),
      );
      expect(code).toBe(FOREIGN_KEY_VIOLATION);
    }
  });

  it("never gives two photos of a car the same name", async () => {
    const photo = () =>
      carFileRow(operatorAId, "vehicle_photo", { vehicleId: carAId, label: "A 2026-10-31 001" });
    await withTenant(web.db, operatorAId, (tx) => tx.insert(schema.files).values(photo()));
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) => tx.insert(schema.files).values(photo())),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("needs a car for car files, a name for a photo or document, and a photo for a small copy", async () => {
    const attempts = [
      carFileRow(operatorAId, "vehicle_photo", { label: "A 2026-10-30 001" }),
      carFileRow(operatorAId, "vehicle_photo", { vehicleId: carAId }),
      carFileRow(operatorAId, "vehicle_document", { vehicleId: carAId }),
      carFileRow(operatorAId, "vehicle_photo_thumbnail", { vehicleId: carAId }),
      carFileRow(operatorAId, "operator_logo", { vehicleId: carAId }),
    ];
    for (const row of attempts) {
      const code = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) => tx.insert(schema.files).values(row)),
      );
      expect(code).toBe(CHECK_VIOLATION);
    }
    await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.files)
        .values(
          carFileRow(operatorAId, "vehicle_document", { vehicleId: carAId, label: "Report" }),
        ),
    );
  });

  describe("attachments", () => {
    let costAId: string;
    let costBId: string;
    let saleAId: string;

    async function addCost(operatorId: string, vehicleId: string): Promise<string> {
      const [cost] = await withTenant(web.db, operatorId, (tx) =>
        tx
          .insert(schema.vehicleCosts)
          .values({
            operatorId,
            vehicleId,
            incurredOn: "2026-10-30",
            kind: "repair",
            description: "Tyres",
            costCents: 11_000,
            gstCents: 1_000,
          })
          .returning({ id: schema.vehicleCosts.id }),
      );
      return cost!.id;
    }

    beforeAll(async () => {
      costAId = await addCost(operatorAId, carAId);
      costBId = await addCost(operatorBId, carBId);
      const [sale] = await withTenant(web.db, operatorAId, (tx) =>
        tx
          .insert(schema.vehicleSales)
          .values({
            operatorId: operatorAId,
            vehicleId: carAId,
            soldAt: new Date(),
            priceCents: 100,
            buyerName: "Test Buyer",
            buyerPhone: "0412 345 678",
            buyerAddress: "1 Test St",
          })
          .returning({ id: schema.vehicleSales.id }),
      );
      saleAId = sale!.id;
    });

    const insertAsA = (row: ReturnType<typeof carFileRow>) =>
      postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) => tx.insert(schema.files).values(row)),
      );

    it("cannot attach to another Operator's record", async () => {
      expect(
        await insertAsA(
          carFileRow(operatorAId, "vehicle_attachment", {
            vehicleId: carAId,
            costId: costBId,
            label: "Receipt 1",
          }),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);
    });

    it("keeps sale and purchase papers as identity attachments, and nothing else", async () => {
      const wrongKinds = [
        carFileRow(operatorAId, "vehicle_attachment", {
          vehicleId: carAId,
          saleId: saleAId,
          label: "Sale 1",
        }),
        carFileRow(operatorAId, "vehicle_identity_attachment", {
          vehicleId: carAId,
          costId: costAId,
          label: "Receipt 1",
        }),
        carFileRow(operatorAId, "vehicle_attachment", { vehicleId: carAId, label: "Nothing 1" }),
      ];
      for (const row of wrongKinds) {
        expect(await insertAsA(row)).toBe(CHECK_VIOLATION);
      }
      expect(
        await insertAsA({
          ...carFileRow(operatorAId, "vehicle_identity_attachment", {
            vehicleId: carAId,
            saleId: saleAId,
            label: "Sale 1",
          }),
          storageArea: "identity",
        }),
      ).toBeUndefined();
    });
  });
});
