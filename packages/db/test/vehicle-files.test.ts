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
  links: { vehicleId?: string; label?: string; thumbnailOfFileId?: string },
) {
  const id = randomUUID();
  return {
    id,
    operatorId,
    purpose,
    storageArea: "general" as const,
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
});
