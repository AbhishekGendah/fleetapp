import { drawnSignatureInput } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage } from "@fleetapp/email";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { completeReturn } from "../src/lib/handover/complete-return";
import { startReturn } from "../src/lib/handover/handover-records";
import { listPastPossessions } from "../src/lib/rentals/timeline-queries";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETURN_KM = HANDOVER_KM + 400;

describe("the timeline's past", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let kit: ReturnType<typeof checklistKit>;
  const window = () => ({
    from: new Date(Date.now() - 30 * DAY_MS),
    to: new Date(Date.now() + 30 * DAY_MS),
  });

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    actor = await seedOperatorWithUser(admin, "Timeline Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Timeline Rentals Pty Ltd");
    const sentEmails: EmailMessage[] = [];
    kit = checklistKit(web, storage, sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("lists a returned rental's time with the car, not one still out, and only to its business", async () => {
    const returned = await kit.rentalOut(new Date(Date.now() - 5 * DAY_MS));
    const stillOut = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
    const started = await startReturn(web.db, actor, returned.rentalId);
    const returnId = "inspectionId" in started ? started.inspectionId : "";
    await kit.fillChecklist(returnId, RETURN_KM);
    const result = await completeReturn(
      kit.handoverDeps(),
      actor,
      returnId,
      {
        shownFingerprint: await kit.shown(returnId),
        returnedAt: new Date(Date.now() - DAY_MS),
        signature: drawnSignatureInput(TEST_SIGNATURE),
        carAfter: { status: "available", statusReason: null, statusExpectedBack: null },
      },
      { timeZone: TEST_TIME_ZONE, now: new Date() },
    );
    expect(result.status).toBe("completed");

    const past = await listPastPossessions(web.db, actor.operatorId, window());
    expect(past.map((row) => row.rentalId)).toEqual([returned.rentalId]);
    expect(past.map((row) => row.rentalId)).not.toContain(stillOut.rentalId);
    expect(past[0]?.vehicleId).toBe(returned.vehicleId);
    expect(past[0]!.endedAt.getTime()).toBeGreaterThan(past[0]!.startedAt.getTime());

    const longAgo = { from: new Date("2020-01-01"), to: new Date("2020-02-01") };
    expect(await listPastPossessions(web.db, actor.operatorId, longAgo)).toEqual([]);
    expect(await listPastPossessions(web.db, otherOperator.operatorId, window())).toEqual([]);
  });
});
