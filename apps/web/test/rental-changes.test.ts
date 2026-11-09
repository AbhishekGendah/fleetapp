import { randomUUID } from "node:crypto";

import { utcToLocalDateTime, type TemplateDocument } from "@fleetapp/core";
import {
  carHolds,
  paymentMandates,
  rentalChanges,
  rentalRates,
  rentals,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { loadSigningView, signContract } from "../src/lib/contracts/signing";
import { loadSigningStatus } from "../src/lib/contracts/signing-links";
import { createTemplate, saveTemplate } from "../src/lib/contracts/templates";
import {
  cancelChangeLink,
  changeWeeklyRate,
  listRentalChanges,
  sendChangeForSigning,
  withdrawChange,
} from "../src/lib/rentals/change-signing";
import { changeRentalEnd, rentTermsAfterEndChange } from "../src/lib/rentals/rental-changes";
import { emptyRentalForm, parseRentalForm } from "../src/lib/rentals/rental-input";
import { createRental } from "../src/lib/rentals/rental-records";
import { openLink, wasLinkUsed } from "../src/lib/renter-links/link-visits";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { checklistKit } from "./handover-fixtures";
import { addTestRenter, bookTestRental, TEST_TIME_ZONE } from "./rental-fixtures";

const TOKEN_PATTERN = /\/r\/([A-Za-z0-9_-]+)/;
const META = { ipAddress: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone)" };
const DAY_MS = 24 * 60 * 60 * 1000;
const REASON = "Agreed with the Renter";
/** The first block of a rental's second rent week: the earliest a new rate can start. */
const NEXT_WEEK = 7;
/** The test booking (bookTestRental) runs 1 to 29 June 2027, 9am Perth time. */
const BOOKED_END = new Date("2027-06-29T01:00:00Z");

const CHANGE_FORM: TemplateDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "mergeField", attrs: { key: "renterFullName" } },
        { type: "text", text: " and the business agree: " },
        { type: "mergeField", attrs: { key: "changeSummary" } },
        { type: "text", text: " Because: " },
        { type: "mergeField", attrs: { key: "changeReason" } },
      ],
    },
  ],
};

describe("changes of terms during a rental", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let sentEmails: EmailMessage[];
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let kit: ReturnType<typeof checklistKit>;

  const clock = () => ({ timeZone: TEST_TIME_ZONE, now: new Date() });
  const linkDeps = () => ({
    ...kit.handoverDeps(),
    appUrl: "https://app.example.test",
    describeDay: () => "Friday 6 November",
    describeMoment: () => "3:15 pm AWST, Friday 6 November",
  });

  /** A second booking of the same car, from `start` to `end` (Perth local times). */
  async function bookSameCar(vehicleId: string, start: string, end: string) {
    const renterId = await addTestRenter(web, actor, "Next Renter");
    const input = parseRentalForm(
      {
        ...emptyRentalForm({ renterId, vehicleId }),
        plannedStart: start,
        plannedEnd: end,
        dailyRateCents: "70",
        longTermWeeklyCents: "350",
        bondCents: "500",
      },
      TEST_TIME_ZONE,
    );
    const result = await createRental(web.db, actor, input.data!, "booked", clock());
    if (result.status !== "saved") {
      throw new Error(`Not booked: ${result.status}`);
    }
    return result.rentalId;
  }

  async function heldUntil(rentalId: string): Promise<string | null> {
    const [hold] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ upper: sql<string | null>`upper(${carHolds.heldDuring})::text` })
        .from(carHolds)
        .where(and(eq(carHolds.rentalId, rentalId), isNull(carHolds.releasedAt))),
    );
    return hold?.upper ? new Date(hold.upper).toISOString() : null;
  }

  async function rentalOf(rentalId: string) {
    const [rental] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(rentals).where(eq(rentals.id, rentalId)),
    );
    return rental!;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    sentEmails = [];
    actor = await seedOperatorWithUser(admin, "Changing Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Changing Rentals Pty Ltd");
    kit = checklistKit(web, storage, sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("moves the end and the car's hold together, up to the next booking but not into it", async () => {
    const renterId = await addTestRenter(web, actor);
    const { rentalId, vehicleId } = await bookTestRental(web, actor, renterId);
    const nextId = await bookSameCar(vehicleId, "2027-07-06T09:00", "2027-07-20T09:00");

    const intoNext = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: new Date("2027-07-13T01:00:00Z"), reason: REASON },
      clock(),
    );
    const ongoing = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: null, reason: REASON },
      clock(),
    );
    const upToNext = new Date("2027-07-06T01:00:00Z");
    const extended = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: upToNext, reason: REASON },
      clock(),
    );

    expect(intoNext).toMatchObject({ status: "clash", clash: { rentalId: nextId } });
    expect(ongoing).toMatchObject({ status: "clash", clash: { rentalId: nextId } });
    expect(extended).toMatchObject({ status: "changed", noticeDaysShort: 0 });
    expect((await rentalOf(rentalId)).plannedEnd).toEqual(upToNext);
    expect(await heldUntil(rentalId)).toBe(upToNext.toISOString());
    const changes = await listRentalChanges(web.db, actor.operatorId, rentalId, new Date());
    expect(changes).toEqual([
      expect.objectContaining({
        kind: "end_date",
        status: "applied",
        endBefore: BOOKED_END,
        endAfter: upToNext,
        reason: REASON,
      }),
    ]);
  });

  it("makes a rental ongoing, then gives it an end, warning when the notice is short", async () => {
    const renterId = await addTestRenter(web, actor);
    const soon = new Date(Date.now() + 2 * DAY_MS);
    const vehicleId = await addTestCar(web, actor);
    const input = parseRentalForm(
      {
        ...emptyRentalForm({ renterId, vehicleId }),
        plannedStart: utcToLocalDateTime(soon, TEST_TIME_ZONE),
        plannedEnd: utcToLocalDateTime(new Date(soon.getTime() + 28 * DAY_MS), TEST_TIME_ZONE),
        dailyRateCents: "70",
        longTermWeeklyCents: "350",
        bondCents: "500",
      },
      TEST_TIME_ZONE,
    );
    const booked = await createRental(web.db, actor, input.data!, "booked", clock());
    const rentalId = booked.status === "saved" ? booked.rentalId : "";

    const madeOngoing = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: null, reason: REASON },
      clock(),
    );
    const again = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: null, reason: REASON },
      clock(),
    );
    expect(madeOngoing.status).toBe("changed");
    expect(again).toEqual({ status: "unchanged" });
    expect((await rentalOf(rentalId)).type).toBe("ongoing");
    expect(await heldUntil(rentalId)).toBeNull();

    // The default notice is 7 days; three days from now is four short.
    const shortEnd = new Date(Date.now() + 3 * DAY_MS + 60_000);
    const ended = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: shortEnd, reason: "Renter is moving interstate" },
      clock(),
    );
    const inPast = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: new Date(Date.now() - DAY_MS), reason: REASON },
      clock(),
    );
    expect(ended).toMatchObject({ status: "changed", noticeDaysShort: 4 });
    expect(inPast).toEqual({ status: "in_past" });
    const [latest] = await listRentalChanges(web.db, actor.operatorId, rentalId, new Date());
    expect(latest).toMatchObject({ kind: "end_date", isShortNotice: true, typeBefore: "ongoing" });
  });

  it("refuses a rate change without a change-of-terms template, leaving nothing behind", async () => {
    const owner = await seedOperatorWithUser(admin, "No Change Form Pty Ltd");
    const renterId = await addTestRenter(web, owner);
    const { rentalId } = await bookTestRental(web, owner, renterId);

    const result = await changeWeeklyRate(
      linkDeps(),
      owner,
      rentalId,
      { weeklyRateCents: 380_00, fromBlock: NEXT_WEEK, reason: REASON },
      clock(),
    );

    expect(result).toEqual({ status: "no_template" });
    expect(await listRentalChanges(web.db, owner.operatorId, rentalId, new Date())).toEqual([]);
  });

  it("sends a rate change to sign; it becomes the rate only once signed, and never twice", async () => {
    const templateId = await createTemplate(web.db, actor, {
      kind: "change_of_terms",
      name: "Change form",
    });
    await saveTemplate(web.db, actor, templateId, { name: "Change form", content: CHANGE_FORM });
    const { rentalId } = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
    const request = { weeklyRateCents: 380_00, fromBlock: NEXT_WEEK, reason: "Yearly review" };
    const rateClock = clock();
    sentEmails.length = 0;

    const sent = await changeWeeklyRate(linkDeps(), actor, rentalId, request, rateClock);
    const second = await changeWeeklyRate(linkDeps(), actor, rentalId, request, rateClock);
    expect(sent).toMatchObject({ status: "sent", isEmailed: true });
    expect(second).toEqual({ status: "one_waiting" });
    expect(sentEmails.map((email) => email.subject)).toEqual([
      expect.stringMatching(/^A change to your rental from /),
    ]);
    const ratesBefore = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(rentalRates).where(eq(rentalRates.rentalId, rentalId)),
    );
    expect(ratesBefore).toHaveLength(1);
    // The contract's own link status is not confused with the change's.
    expect(
      (await loadSigningStatus(web.db, actor.operatorId, rentalId, new Date())).link,
    ).toBeNull();

    const token = TOKEN_PATTERN.exec(sentEmails[0]?.html ?? "")?.[1] ?? "";
    const visit = await openLink(web.db, token);
    expect(visit?.purpose).toBe("sign_change");
    // The change form shows only what it is about (review A3-9).
    const view = await loadSigningView(web.db, visit!);
    const labels = view.status === "ready" ? view.details.map(([label]) => label) : [];
    expect(labels).toEqual(["Name", "Car", "What is changing", "Why"]);
    const signed = await signContract(
      linkDeps(),
      visit!,
      {
        areDetailsConfirmed: "on",
        hasConsented: "on",
        method: "typed",
        typedName: "Rory Ready",
        drawnSignature: "",
        contractFingerprint: visit!.signing!.contractFingerprint,
      },
      META,
    );
    expect(signed.status).toBe("signed");

    const [change] = await listRentalChanges(web.db, actor.operatorId, rentalId, new Date());
    expect(change).toMatchObject({
      kind: "weekly_rate",
      status: "applied",
      rateAfterCents: 380_00,
    });
    expect(change?.documentId).not.toBeNull();
    expect(change?.link).toBeNull();
    const rates = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(rentalRates).where(eq(rentalRates.rentalId, rentalId)),
    );
    expect(
      rates.map((rate) => [rate.weeklyRateCents, rate.dailyRateCents, rate.appliesFromBlock]),
    ).toContainEqual([380_00, 70_00, NEXT_WEEK]);
    // A week that already has a signed rate can't be given another (review A3-1, A4-6).
    expect(await changeWeeklyRate(linkDeps(), actor, rentalId, request, rateClock)).toEqual({
      status: "already_has_rate",
    });
    expect(sentEmails.at(-1)?.subject).toMatch(/Change of terms signed|signed change of terms/);
    expect(await sendChangeForSigning(linkDeps(), actor, change!.id, clock())).toEqual({
      status: "already_signed",
    });
  });

  it("gives a direct-debit Renter 30 days' notice of a rise, moving its start when signed late (slice 5)", async () => {
    // The change form template comes from the test before (tests in a file run in order).
    const { rentalId, renterId } = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx.insert(paymentMandates).values({
        operatorId: actor.operatorId,
        renterId,
        method: "becs_debit",
        status: "active",
        stripeSetupIntentId: `seti_notice${randomUUID().replaceAll("-", "")}`,
        stripePaymentMethodId: `pm_notice${randomUUID().replaceAll("-", "")}`,
        stripeMandateId: `mandate_notice${randomUUID().replaceAll("-", "")}`,
        setUpAt: new Date(),
        activatedAt: new Date(),
      }),
    );
    const rise = { weeklyRateCents: 380_00, reason: "Yearly review" };
    expect(
      await changeWeeklyRate(
        linkDeps(),
        actor,
        rentalId,
        { ...rise, fromBlock: NEXT_WEEK },
        clock(),
      ),
    ).toEqual({ status: "needs_notice" });
    // 30 days from the handover two days ago is block 32: the first week start after is block 35.
    sentEmails.length = 0;
    const sent = await changeWeeklyRate(
      linkDeps(),
      actor,
      rentalId,
      { ...rise, fromBlock: 35 },
      clock(),
    );
    expect(sent).toMatchObject({ status: "sent" });

    // Signed nine and a half days on: the rise starts at the first rent week 30 days after that.
    const token = TOKEN_PATTERN.exec(sentEmails[0]?.html ?? "")?.[1] ?? "";
    const visit = await openLink(web.db, token);
    const later = new Date(Date.now() + 9.5 * DAY_MS);
    const signed = await signContract(
      { ...linkDeps(), now: () => later },
      visit!,
      {
        areDetailsConfirmed: "on",
        hasConsented: "on",
        method: "typed",
        typedName: "Rory Ready",
        drawnSignature: "",
        contractFingerprint: visit!.signing!.contractFingerprint,
      },
      META,
    );
    expect(signed.status).toBe("signed");
    const rates = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(rentalRates).where(eq(rentalRates.rentalId, rentalId)),
    );
    expect(rates.map((rate) => [rate.weeklyRateCents, rate.appliesFromBlock])).toContainEqual([
      380_00, 42,
    ]);
    // A fall needs no notice.
    const fall = await changeWeeklyRate(
      linkDeps(),
      actor,
      rentalId,
      { weeklyRateCents: 300_00, fromBlock: 14, reason: "Discount" },
      clock(),
    );
    expect(fall).toMatchObject({ status: "sent" });
  });

  it("refuses a rate change mid-week, and signing once its rent week has begun (review A3-1)", async () => {
    const { rentalId } = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
    const midWeek = await changeWeeklyRate(
      linkDeps(),
      actor,
      rentalId,
      { weeklyRateCents: 390_00, fromBlock: NEXT_WEEK + 3, reason: REASON },
      clock(),
    );
    expect(midWeek).toEqual({ status: "not_week_start" });

    sentEmails.length = 0;
    const sent = await changeWeeklyRate(
      linkDeps(),
      actor,
      rentalId,
      { weeklyRateCents: 390_00, fromBlock: NEXT_WEEK, reason: REASON },
      clock(),
    );
    expect(sent).toMatchObject({ status: "sent" });
    const token = TOKEN_PATTERN.exec(sentEmails[0]?.html ?? "")?.[1] ?? "";
    const visit = await openLink(web.db, token);
    const lateDeps = { ...linkDeps(), now: () => new Date(Date.now() + 6 * DAY_MS) };

    const signed = await signContract(
      lateDeps,
      visit!,
      {
        areDetailsConfirmed: "on",
        hasConsented: "on",
        method: "typed",
        typedName: "Rory Ready",
        drawnSignature: "",
        contractFingerprint: visit!.signing!.contractFingerprint,
      },
      META,
    );
    expect(signed.status).toBe("not_signable");
    const rates = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(rentalRates).where(eq(rentalRates.rentalId, rentalId)),
    );
    expect(rates).toHaveLength(1);
  });

  it("withdraws a waiting rate change and stops its link", async () => {
    const { rentalId } = await kit.rentalOut(new Date(Date.now() - DAY_MS));
    sentEmails.length = 0;
    const sent = await changeWeeklyRate(
      linkDeps(),
      actor,
      rentalId,
      { weeklyRateCents: 400_00, fromBlock: NEXT_WEEK, reason: "Higher insurance" },
      clock(),
    );
    const changeId = sent.status === "sent" ? sent.changeId : "";
    const token = TOKEN_PATTERN.exec(sentEmails[0]?.html ?? "")?.[1] ?? "";

    expect(await withdrawChange(web.db, otherOperator, changeId, new Date())).toBe("not_found");
    expect(await withdrawChange(web.db, actor, changeId, new Date())).toBe("withdrawn");
    expect(await withdrawChange(web.db, actor, changeId, new Date())).toBe("not_found");
    expect(await openLink(web.db, token)).toBeNull();
    const [change] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(rentalChanges).where(eq(rentalChanges.id, changeId)),
    );
    expect(change?.status).toBe("withdrawn");
  });

  /** An end some days after the rental's own start (a test rental starts well ahead). */
  const endAfterStart = async (rentalId: string, days: number): Promise<Date> =>
    new Date((await rentalOf(rentalId)).plannedStart.getTime() + days * DAY_MS);

  /** The newest emailed link's secret. */
  const lastToken = () => TOKEN_PATTERN.exec(sentEmails.at(-1)?.html ?? "")?.[1] ?? "";
  const typedSign = (visit: NonNullable<Awaited<ReturnType<typeof openLink>>>) =>
    signContract(
      linkDeps(),
      visit,
      {
        areDetailsConfirmed: "on",
        hasConsented: "on",
        method: "typed",
        typedName: "Rory Ready",
        drawnSignature: "",
        contractFingerprint: visit.signing!.contractFingerprint,
      },
      META,
    );

  it("keeps one change's link working when another change is sent or withdrawn (review A3-2)", async () => {
    const { rentalId } = await kit.rentalOut(new Date(Date.now() - DAY_MS));
    const rate = await changeWeeklyRate(
      linkDeps(),
      actor,
      rentalId,
      { weeklyRateCents: 410_00, fromBlock: NEXT_WEEK, reason: REASON },
      clock(),
    );
    const rateToken = lastToken();
    const ended = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: await endAfterStart(rentalId, 40), reason: REASON },
      clock(),
    );
    const endChangeId = ended.status === "changed" ? ended.changeId : "";
    await sendChangeForSigning(linkDeps(), actor, endChangeId, clock());
    const endToken = lastToken();

    expect(await openLink(web.db, rateToken)).not.toBeNull();
    await withdrawChange(web.db, actor, rate.status === "sent" ? rate.changeId : "", new Date());
    expect(await openLink(web.db, rateToken)).toBeNull();
    expect(await openLink(web.db, endToken)).not.toBeNull();
    // Its own link can be cancelled on its own; the change stays in effect (review A3-3).
    expect(await cancelChangeLink(web.db, actor, endChangeId, new Date())).toBe("cancelled");
    expect(await openLink(web.db, endToken)).toBeNull();
    const [kept] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(rentalChanges).where(eq(rentalChanges.id, endChangeId)),
    );
    expect(kept?.status).toBe("applied");
  });

  it("refuses an end change a later one replaced, and stops its link (review A3-12)", async () => {
    const { rentalId } = await kit.rentalOut(new Date(Date.now() - DAY_MS));
    const first = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: await endAfterStart(rentalId, 30), reason: REASON },
      clock(),
    );
    const firstId = first.status === "changed" ? first.changeId : "";
    await sendChangeForSigning(linkDeps(), actor, firstId, clock());
    const firstToken = lastToken();

    await changeRentalEnd(web.db, actor, rentalId, { newEnd: null, reason: REASON }, clock());

    expect(await openLink(web.db, firstToken)).toBeNull();
    expect(await sendChangeForSigning(linkDeps(), actor, firstId, clock())).toEqual({
      status: "not_signable",
    });
    const replaced = (await listRentalChanges(web.db, actor.operatorId, rentalId, new Date())).find(
      (change) => change.id === firstId,
    );
    expect(replaced?.signingProblem).toBe("replaced");
  });

  it("tells a stopped link from a signed one (review A3-7)", async () => {
    const { rentalId } = await kit.rentalOut(new Date(Date.now() - DAY_MS));
    const ended = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: await endAfterStart(rentalId, 50), reason: REASON },
      clock(),
    );
    const changeId = ended.status === "changed" ? ended.changeId : "";
    await sendChangeForSigning(linkDeps(), actor, changeId, clock());
    const stopped = (await openLink(web.db, lastToken()))!;
    await cancelChangeLink(web.db, actor, changeId, new Date());

    expect(await typedSign(stopped)).toMatchObject({ status: "link_stopped" });

    await sendChangeForSigning(linkDeps(), actor, changeId, clock());
    const token = lastToken();
    expect((await typedSign((await openLink(web.db, token))!)).status).toBe("signed");
    expect(await openLink(web.db, token)).toBeNull();
    expect(await wasLinkUsed(web.db, token)).toBe(true);
  });

  it("signs nothing when the change is replaced while it is being signed (review A3-12)", async () => {
    const { rentalId } = await kit.rentalOut(new Date(Date.now() - DAY_MS));
    const ended = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: await endAfterStart(rentalId, 60), reason: REASON },
      clock(),
    );
    await sendChangeForSigning(
      linkDeps(),
      actor,
      ended.status === "changed" ? ended.changeId : "",
      clock(),
    );
    expect(ended.status).toBe("changed");
    const visit = (await openLink(web.db, lastToken()))!;
    const deps = linkDeps();
    // The business makes the rental ongoing in the moment the signed form is being stored.
    const save = deps.storage.save.bind(deps.storage);
    deps.storage.save = async (area, key, bytes, contentType) => {
      await changeRentalEnd(web.db, actor, rentalId, { newEnd: null, reason: REASON }, clock());
      return save(area, key, bytes, contentType);
    };

    const result = await signContract(
      deps,
      visit,
      {
        areDetailsConfirmed: "on",
        hasConsented: "on",
        method: "typed",
        typedName: "Rory Ready",
        drawnSignature: "",
        contractFingerprint: visit.signing!.contractFingerprint,
      },
      META,
    );

    // The business replaced it, which stops its link: nothing is signed, and the Renter is told so.
    expect(result).toEqual({ status: "link_stopped" });
    const [change] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ documentId: rentalChanges.documentId })
        .from(rentalChanges)
        .where(eq(rentalChanges.id, ended.status === "changed" ? ended.changeId : "")),
    );
    expect(change?.documentId).toBeNull();
  });

  it("withdraws a rate change not signed in time when the next one is proposed (review A3-1)", async () => {
    const { rentalId } = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
    const first = await changeWeeklyRate(
      linkDeps(),
      actor,
      rentalId,
      { weeklyRateCents: 420_00, fromBlock: NEXT_WEEK, reason: REASON },
      clock(),
    );
    const later = { timeZone: TEST_TIME_ZONE, now: new Date(Date.now() + 6 * DAY_MS) };

    const next = await changeWeeklyRate(
      { ...linkDeps(), now: () => later.now },
      actor,
      rentalId,
      { weeklyRateCents: 430_00, fromBlock: 2 * NEXT_WEEK, reason: REASON },
      later,
    );
    const [firstNow] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select()
        .from(rentalChanges)
        .where(eq(rentalChanges.id, first.status === "sent" ? first.changeId : "")),
    );

    expect(next.status).toBe("sent");
    expect(firstNow?.status).toBe("withdrawn");
  });

  it("moves a booking between short hire and long-term as its end moves, before the handover", async () => {
    const renterId = await addTestRenter(web, actor);
    const { rentalId } = await bookTestRental(web, actor, renterId);
    expect((await rentalOf(rentalId)).isLongTerm).toBe(true);

    const shortened = await changeRentalEnd(
      web.db,
      actor,
      rentalId,
      { newEnd: new Date("2027-06-04T01:00:00Z"), reason: REASON },
      clock(),
    );

    expect(shortened.status).toBe("changed");
    expect(await rentalOf(rentalId)).toMatchObject({ isLongTerm: false, bookedBlocks: 3 });
  });

  it("keeps a car that is out on its booked terms, and won't make a short hire ongoing", () => {
    const out = {
      rentModel: "blocks" as const,
      handedOverAt: new Date("2027-06-01T01:00:00Z"),
      plannedStart: new Date("2027-06-01T01:00:00Z"),
      graceMinutes: 60,
      longTermMinimumDays: 7,
    };
    expect(rentTermsAfterEndChange({ ...out, isLongTerm: false }, null)).toBe("short_hire_ongoing");
    expect(
      rentTermsAfterEndChange({ ...out, isLongTerm: false }, new Date("2027-06-20T01:00:00Z")),
    ).toEqual({});
    expect(rentTermsAfterEndChange({ ...out, isLongTerm: true }, null)).toEqual({});
  });

  it("keeps each business's rentals and changes to itself", async () => {
    const renterId = await addTestRenter(web, actor);
    const { rentalId } = await bookTestRental(web, actor, renterId);

    const byOther = await changeRentalEnd(
      web.db,
      otherOperator,
      rentalId,
      { newEnd: new Date("2027-07-01T01:00:00Z"), reason: REASON },
      clock(),
    );

    expect(byOther).toEqual({ status: "not_found" });
    expect(await listRentalChanges(web.db, otherOperator.operatorId, rentalId, new Date())).toEqual(
      [],
    );
    expect((await rentalOf(rentalId)).plannedEnd).toEqual(BOOKED_END);
  });
});
