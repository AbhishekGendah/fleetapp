import { randomUUID } from "node:crypto";

import { activityLog, files, operators, users } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  confirmUpload,
  findLogoViewUrl,
  removeLogo,
  requestUpload,
  type FileActor,
  type FileDependencies,
} from "../src/lib/files/stored-files";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";

const PNG_START = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const NOT_AN_IMAGE = new TextEncoder().encode("<svg onload=alert(1)>");
const LOGO = { purpose: "operator_logo", contentType: "image/png", sizeBytes: 2048 } as const;

describe("storing files", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let deps: FileDependencies;
  let actorA: FileActor;
  let actorB: FileActor;

  async function seedActor(name: string): Promise<FileActor> {
    const [operator] = await admin.db
      .insert(operators)
      .values({ legalName: name })
      .returning({ id: operators.id });
    const [user] = await admin.db
      .insert(users)
      .values({ operatorId: operator!.id, email: `${randomUUID()}@example.test`, fullName: name })
      .returning({ id: users.id });
    return { operatorId: operator!.id, userId: user!.id };
  }

  /** Asks to upload, then sends the bytes as the browser would. */
  async function upload(actor: FileActor, bytes: Uint8Array): Promise<string> {
    const result = await requestUpload(deps, actor, LOGO);
    if (result.status !== "allowed") {
      throw new Error("The upload was refused");
    }
    const key = storage.permissions.at(-1)!.key;
    storage.receive("general", key, bytes);
    return result.fileId;
  }

  async function fileRow(fileId: string) {
    const [row] = await admin.db
      .select({
        confirmedAt: files.confirmedAt,
        refusedAt: files.refusedAt,
        deletedAt: files.deletedAt,
      })
      .from(files)
      .where(eq(files.id, fileId));
    return row;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    deps = { database: web.db, storage, now: () => new Date() };
    actorA = await seedActor("Operator A");
    actorB = await seedActor("Operator B");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("allows one exact address under the Operator, with the type and size limit", async () => {
    await requestUpload(deps, actorA, LOGO);

    const permission = storage.permissions.at(-1)!;
    expect(permission.key.startsWith(`${actorA.operatorId}/operator_logo/`)).toBe(true);
    expect(permission).toMatchObject({
      area: "general",
      contentType: "image/png",
      maxBytes: 5 * 1024 * 1024,
    });
  });

  it("refuses a type or size the purpose does not allow, before anything is stored", async () => {
    const before = storage.permissions.length;

    expect(await requestUpload(deps, actorA, { ...LOGO, contentType: "image/svg+xml" })).toEqual({
      status: "refused",
      problem: "type_not_allowed",
    });
    expect(await requestUpload(deps, actorA, { ...LOGO, sizeBytes: 50 * 1024 * 1024 })).toEqual({
      status: "refused",
      problem: "too_large",
    });
    expect(storage.permissions.length).toBe(before);
  });

  it("confirms a file that really is what it claimed, and shows it as the logo", async () => {
    const fileId = await upload(actorA, PNG_START);

    expect(await confirmUpload(deps, actorA, fileId)).toBe("confirmed");
    expect((await fileRow(fileId))?.confirmedAt).not.toBeNull();
    expect(await findLogoViewUrl(deps, actorA.operatorId)).toContain(actorA.operatorId);
  });

  it("removes and refuses a file that is not what it claimed", async () => {
    const fileId = await upload(actorA, NOT_AN_IMAGE);
    const key = storage.permissions.at(-1)!.key;

    expect(await confirmUpload(deps, actorA, fileId)).toBe("wrong_type");
    expect(storage.has("general", key)).toBe(false);
    expect((await fileRow(fileId))?.refusedAt).not.toBeNull();
  });

  it("waits when nothing has arrived yet", async () => {
    const result = await requestUpload(deps, actorA, LOGO);
    const fileId = result.status === "allowed" ? result.fileId : "";

    expect(await confirmUpload(deps, actorA, fileId)).toBe("not_arrived");
  });

  it("will not confirm another Operator's file", async () => {
    const fileId = await upload(actorB, PNG_START);

    expect(await confirmUpload(deps, actorA, fileId)).toBe("not_found");
    expect((await fileRow(fileId))?.confirmedAt).toBeNull();
  });

  it("replaces the old logo, marking it deleted, and logs both", async () => {
    const first = await upload(actorB, PNG_START);
    await confirmUpload(deps, actorB, first);
    const second = await upload(actorB, PNG_START);
    await confirmUpload(deps, actorB, second);

    expect((await fileRow(first))?.deletedAt).not.toBeNull();
    expect((await fileRow(second))?.deletedAt).toBeNull();
    const history = await admin.db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(
        and(eq(activityLog.operatorId, actorB.operatorId), eq(activityLog.entityType, "file")),
      );
    expect(history.map((line) => line.action)).toEqual(
      expect.arrayContaining(["uploaded", "deleted"]),
    );
  });

  it("removes the logo, leaving none to show", async () => {
    expect(await removeLogo(deps, actorB)).toBe(true);
    expect(await findLogoViewUrl(deps, actorB.operatorId)).toBeNull();
    expect(await removeLogo(deps, actorB)).toBe(false);
  });
});
