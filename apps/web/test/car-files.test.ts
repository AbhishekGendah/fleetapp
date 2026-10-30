import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import {
  findCarFileViewUrl,
  listCarDocuments,
  listCarPhotos,
  removeCarFile,
  startCarDocumentUpload,
  startCarPhotoUpload,
} from "../src/lib/files/car-files";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { archiveVehicle } from "../src/lib/vehicles/vehicle-records";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";

const JPEG_START = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF_START = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ");
const PERTH = "Australia/Perth";
const PHOTO = { contentType: "image/jpeg", sizeBytes: 400_000 };
const THUMBNAIL = { contentType: "image/jpeg", sizeBytes: 30_000 };

describe("car photos and documents", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let deps: FileDependencies;
  let actor: ActingUser;
  let otherActor: ActingUser;

  /** Sends the bytes to the address the last permission was for, as the browser would. */
  function sendLast(bytes: Uint8Array): void {
    storage.receive("general", storage.permissions.at(-1)!.key, bytes);
  }

  async function addPhoto(vehicleId: string): Promise<string> {
    const start = await startCarPhotoUpload(
      deps,
      actor,
      vehicleId,
      { photo: PHOTO, thumbnail: THUMBNAIL },
      PERTH,
    );
    if (start.status !== "allowed") {
      throw new Error("The photo was refused.");
    }
    const [photoPermission, thumbnailPermission] = storage.permissions.slice(-2);
    storage.receive("general", photoPermission!.key, JPEG_START);
    storage.receive("general", thumbnailPermission!.key, JPEG_START);
    expect(await confirmUpload(deps, actor, start.photo.fileId)).toBe("confirmed");
    expect(await confirmUpload(deps, actor, start.thumbnail.fileId)).toBe("confirmed");
    return start.photo.fileId;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    deps = { database: web.db, storage, now: () => new Date() };
    actor = await seedOperatorWithUser(admin, "Photos Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Photos Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("lists a car's photos newest first, each shown by its small copy", async () => {
    const carId = await addTestCar(web, actor);
    const first = await addPhoto(carId);
    const second = await addPhoto(carId);

    const photos = await listCarPhotos(deps, actor.operatorId, carId);
    expect(photos.map((photo) => photo.id)).toEqual([second, first]);
    // Named by rego, today in Perth, and number; the open link carries the name.
    const [rego, day] = photos[0]!.label.split(" ");
    expect(photos.map((photo) => photo.label)).toEqual([
      `${rego} ${day} 002`,
      `${rego} ${day} 001`,
    ]);
    expect(await findCarFileViewUrl(deps, actor.operatorId, carId, first)).toContain(
      encodeURIComponent(`${rego} ${day} 001.jpg`),
    );
    expect(photos[0]?.thumbnailUrl).toContain("vehicle_photo_thumbnail");
  });

  it("gives photos sent at the same moment a number each", async () => {
    const carId = await addTestCar(web, actor);
    const starts = await Promise.all(
      [1, 2, 3].map(() =>
        startCarPhotoUpload(deps, actor, carId, { photo: PHOTO, thumbnail: THUMBNAIL }, PERTH),
      ),
    );
    expect(starts.every((start) => start.status === "allowed")).toBe(true);
    const rows = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ label: files.label })
        .from(files)
        .where(and(eq(files.vehicleId, carId), eq(files.purpose, "vehicle_photo"))),
    );
    const numbers = rows.map((row) => row.label?.split(" ").at(-1)).sort();
    expect(numbers).toEqual(["001", "002", "003"]);
  });

  it("keeps a document's name and refuses one that is not what it claims", async () => {
    const carId = await addTestCar(web, actor);
    const start = await startCarDocumentUpload(deps, actor, carId, {
      contentType: "application/pdf",
      sizeBytes: 50_000,
      label: "Pre-purchase inspection",
    });
    if (start.status !== "allowed") {
      throw new Error("The document was refused.");
    }
    sendLast(PDF_START);
    expect(await confirmUpload(deps, actor, start.fileId)).toBe("confirmed");

    const fake = await startCarDocumentUpload(deps, actor, carId, {
      contentType: "application/pdf",
      sizeBytes: 50_000,
      label: "Not really a PDF",
    });
    if (fake.status !== "allowed") {
      throw new Error("The second document was refused.");
    }
    sendLast(new TextEncoder().encode("<script>alert(1)</script>"));
    expect(await confirmUpload(deps, actor, fake.fileId)).toBe("wrong_type");

    const documents = await listCarDocuments(web.db, actor.operatorId, carId);
    expect(documents.map((document) => document.label)).toEqual(["Pre-purchase inspection"]);
    expect(
      await startCarDocumentUpload(deps, actor, carId, {
        contentType: "application/zip",
        sizeBytes: 50_000,
        label: "Zip",
      }),
    ).toMatchObject({ status: "refused" });
  });

  it("removes a photo with its small copy, and only for its own Operator and car", async () => {
    const carId = await addTestCar(web, actor);
    const otherCarId = await addTestCar(web, actor);
    const photoId = await addPhoto(carId);

    expect(await findCarFileViewUrl(deps, otherActor.operatorId, carId, photoId)).toBeNull();
    expect(await findCarFileViewUrl(deps, actor.operatorId, otherCarId, photoId)).toBeNull();
    expect(await findCarFileViewUrl(deps, actor.operatorId, carId, photoId)).toContain(
      "vehicle_photo/",
    );
    expect(await removeCarFile(deps, otherActor, carId, photoId)).toBe("not_found");
    expect(await removeCarFile(deps, actor, carId, photoId)).toBe("removed");
    expect(await listCarPhotos(deps, actor.operatorId, carId)).toEqual([]);
    expect(await findCarFileViewUrl(deps, actor.operatorId, carId, photoId)).toBeNull();
  });

  it("takes no files for another Operator's car or an archived car", async () => {
    const carId = await addTestCar(web, actor);
    expect(
      await startCarPhotoUpload(
        deps,
        otherActor,
        carId,
        { photo: PHOTO, thumbnail: THUMBNAIL },
        PERTH,
      ),
    ).toEqual({ status: "not_found" });
    await archiveVehicle(web.db, actor, carId);
    expect(
      await startCarPhotoUpload(deps, actor, carId, { photo: PHOTO, thumbnail: THUMBNAIL }, PERTH),
    ).toEqual({ status: "not_found" });
  });
});
