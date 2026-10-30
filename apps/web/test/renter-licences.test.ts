import { WITHHELD_VALUE } from "@fleetapp/core";
import { activityLog, files } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import {
  licenceFormValues,
  parseLicenceForm,
  type LicenceFormValues,
  type LicenceInput,
} from "../src/lib/renters/licence-input";
import { saveLicence } from "../src/lib/renters/licence-records";
import {
  listLicenceScans,
  listRenterFileIds,
  openLicenceScan,
  removeLicenceScan,
  startLicenceScanUpload,
} from "../src/lib/renters/licence-scans";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { loadRenter } from "../src/lib/renters/renter-queries";
import { archiveRenter, createRenter } from "../src/lib/renters/renter-records";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";

const JPEG_START = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const SCAN = { contentType: "image/jpeg", sizeBytes: 300_000 };
const LICENCE_FORM: LicenceFormValues = {
  licenceIssuedIn: "WA",
  licenceCountry: "",
  licenceNumber: "12 34 567",
  licenceClass: "C",
  licenceType: "full",
  licenceExpiresOn: "2028-05-04",
};

function licence(changes: Partial<LicenceFormValues> = {}): LicenceInput {
  const parsed = parseLicenceForm({ ...LICENCE_FORM, ...changes });
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}

describe("the licence form's rules", () => {
  it("keeps capitals and digits only, up to 10 in Australia and 20 overseas", () => {
    expect(licence().licenceNumber).toBe("1234567");
    expect(licence({ licenceNumber: "abc-123456789xyz" }).licenceNumber).toBe("ABC1234567");
    expect(
      licence({
        licenceIssuedIn: "overseas",
        licenceCountry: "NZ",
        licenceNumber: "dl 1234 5678 9012 3456 78",
      }).licenceNumber,
    ).toBe("DL123456789012345678");
  });

  it("needs a country for an overseas licence, and drops it otherwise", () => {
    expect(parseLicenceForm({ ...LICENCE_FORM, licenceIssuedIn: "overseas" }).success).toBe(false);
    expect(
      parseLicenceForm({ ...LICENCE_FORM, licenceIssuedIn: "overseas", licenceCountry: "AU" })
        .success,
    ).toBe(false);
    expect(licence({ licenceCountry: "NZ" }).licenceCountry).toBeNull();
  });

  it("starts a blank form on a full car licence", () => {
    expect(
      licenceFormValues({
        licenceIssuedIn: null,
        licenceCountry: null,
        licenceNumber: null,
        licenceClass: null,
        licenceType: null,
        licenceExpiresOn: null,
      }),
    ).toMatchObject({ licenceClass: "C", licenceType: "full" });
  });
});

describe("a Renter's licence and scans", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let deps: FileDependencies;
  let actor: ActingUser;
  let otherActor: ActingUser;

  async function addRenter(name = "Sam Example"): Promise<string> {
    const parsed = parseRenterForm(
      { ...emptyRenterForm(), fullName: name, phone: "0412345678" },
      "2026-10-30",
    );
    return createRenter(web.db, actor, parsed.data!);
  }

  async function addScan(renterId: string, side: "front" | "back"): Promise<string> {
    const start = await startLicenceScanUpload(deps, actor, renterId, side, SCAN);
    if (start.status !== "allowed") {
      throw new Error(`The scan was not allowed: ${start.status}`);
    }
    const permission = storage.permissions.at(-1)!;
    storage.receive(permission.area, permission.key, JPEG_START);
    expect(await confirmUpload(deps, actor, start.fileId)).toBe("confirmed");
    return start.fileId;
  }

  async function fileLog(fileIds: string[]) {
    return withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ id: activityLog.entityId, action: activityLog.action })
        .from(activityLog)
        .where(and(eq(activityLog.entityType, "file"), inArray(activityLog.entityId, fileIds)))
        .orderBy(asc(activityLog.occurredAt)),
    );
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    deps = { database: web.db, storage, now: () => new Date() };
    actor = await seedOperatorWithUser(admin, "Licences Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Licences Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("saves a licence, logging that it changed but never its details", async () => {
    const renterId = await addRenter();
    expect(await saveLicence(web.db, actor, renterId, licence())).toBe("saved");
    expect(await saveLicence(web.db, actor, renterId, licence())).toBe("unchanged");
    expect(await loadRenter(web.db, actor.operatorId, renterId)).toMatchObject({
      licenceNumber: "1234567",
      licenceExpiresOn: "2028-05-04",
    });
    const [line] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ after: activityLog.valuesAfter })
        .from(activityLog)
        .where(and(eq(activityLog.entityId, renterId), eq(activityLog.action, "updated"))),
    );
    expect(line?.after).toMatchObject({ licenceNumber: WITHHELD_VALUE });
    expect(JSON.stringify(line)).not.toContain("1234567");
  });

  it("refuses a licence another Renter has, archived ones too, and says who", async () => {
    const first = await addRenter("First Example");
    await saveLicence(web.db, actor, first, licence({ licenceNumber: "7777777" }));
    await archiveRenter(web.db, actor, first);
    const second = await addRenter("Second Example");
    expect(await saveLicence(web.db, actor, second, licence({ licenceNumber: "7777777" }))).toEqual(
      {
        status: "on_file",
        renterId: first,
        isArchived: true,
      },
    );
    expect(
      await saveLicence(
        web.db,
        actor,
        second,
        licence({ licenceNumber: "7777777", licenceIssuedIn: "NSW" }),
      ),
    ).toBe("saved");
  });

  it("keeps one scan per side, replacing the old one, and logs every view", async () => {
    const renterId = await addRenter();
    const firstFront = await addScan(renterId, "front");
    const newFront = await addScan(renterId, "front");
    const back = await addScan(renterId, "back");

    const scans = await listLicenceScans(web.db, actor.operatorId, renterId);
    expect(scans.front?.id).toBe(newFront);
    expect(scans.back?.id).toBe(back);
    expect(storage.permissions.at(-1)?.area).toBe("identity");

    expect(await openLicenceScan(deps, actor, renterId, newFront)).toContain("identity");
    expect(await openLicenceScan(deps, actor, renterId, newFront)).not.toBeNull();
    expect(await openLicenceScan(deps, actor, renterId, firstFront)).toBeNull();

    expect(await removeLicenceScan(deps, actor, renterId, back)).toBe("removed");
    expect((await listLicenceScans(web.db, actor.operatorId, renterId)).back).toBeNull();

    const log = await fileLog([firstFront, newFront, back]);
    expect(log.filter((line) => line.id === newFront).map((line) => line.action)).toEqual([
      "uploaded",
      "viewed",
      "viewed",
    ]);
    expect(log.filter((line) => line.id === firstFront).map((line) => line.action)).toEqual([
      "uploaded",
      "deleted",
    ]);
    expect(new Set(await listRenterFileIds(web.db, actor.operatorId, renterId))).toEqual(
      new Set([firstFront, newFront, back]),
    );
  });

  it("keeps one Operator's licences and scans from another, and archived Renters read-only", async () => {
    const renterId = await addRenter();
    const front = await addScan(renterId, "front");
    expect(await saveLicence(web.db, otherActor, renterId, licence())).toBe("not_found");
    expect(await startLicenceScanUpload(deps, otherActor, renterId, "back", SCAN)).toEqual({
      status: "not_found",
    });
    expect(await openLicenceScan(deps, otherActor, renterId, front)).toBeNull();
    expect(await removeLicenceScan(deps, otherActor, renterId, front)).toBe("not_found");
    expect(await listLicenceScans(web.db, otherActor.operatorId, renterId)).toEqual({
      front: null,
      back: null,
    });

    await archiveRenter(web.db, actor, renterId);
    expect(await startLicenceScanUpload(deps, actor, renterId, "back", SCAN)).toEqual({
      status: "not_found",
    });
    const [refused] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.renterId, renterId), eq(files.licenceSide, "back"))),
    );
    expect(refused).toBeUndefined();
  });
});
