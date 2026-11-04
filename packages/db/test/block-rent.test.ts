import { eq } from "drizzle-orm";
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

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const EXCLUSION_VIOLATION = "23P01";
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const HANDOVER = new Date("2026-12-04T23:00:00Z");

function blockStart(block: number): Date {
  return new Date(HANDOVER.getTime() + block * DAY_MILLISECONDS);
}

const BLOCK_TERMS = {
  rentModel: "blocks",
  isLongTerm: true,
  graceMinutes: 60,
  longTermMinimumDays: 7,
} as const;

/**
 * Rent in 24-hour blocks (migration 0042): cars carry their prices, a block
 * rental keeps its terms from booking (rule 14), a block period has one
 * original charge however often the run goes (rule 20) and never overlaps
 * another, corrections are extra lines (rule 11), and all of it stays the
 * Operator's own (rules 1, 2 and 5).
 */
describe("rent in blocks", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let renterId: string;
  let rentTypeId: string;

  async function addBlockRental(
    changes: Partial<typeof schema.rentals.$inferInsert> = {},
  ): Promise<string> {
    const vehicleId = await addTestCar(web.db, operatorAId);
    const [rental] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(
          testRentalRow(
            { operatorId: operatorAId, renterId, vehicleId },
            {
              ...BLOCK_TERMS,
              bookedBlocks: 28,
              ...changes,
            },
          ),
        )
        .returning({ id: schema.rentals.id }),
    );
    return rental!.id;
  }

  function addBlockLine(
    rentalId: string,
    firstBlock: number,
    endBlock: number,
    values: Partial<typeof schema.ledgerLines.$inferInsert> = {},
  ) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx.insert(schema.ledgerLines).values({
        operatorId: operatorAId,
        rentalId,
        kind: "charge",
        chargeTypeId: rentTypeId,
        amountCents: 350_00,
        gstCents: 31_82,
        description: "Rent",
        effectiveOn: "2026-12-05",
        periodStartsAt: blockStart(firstBlock),
        periodEndsAt: blockStart(endBlock),
        ...values,
      }),
    );
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    renterId = await addTestRenter(web.db, operatorAId);
    const [rentType] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.chargeTypes)
        .values({ operatorId: operatorAId, builtIn: "weekly_rent" })
        .returning({ id: schema.chargeTypes.id }),
    );
    rentTypeId = rentType!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("lets a car carry a daily rate and a long-term price, never zero or less", async () => {
    const vehicleId = await addTestCar(web.db, operatorAId);
    const setRates = (dailyRateCents: number, longTermWeeklyCents: number | null) =>
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.vehicles)
          .set({ dailyRateCents, longTermWeeklyCents })
          .where(eq(schema.vehicles.id, vehicleId)),
      );

    await setRates(70_00, 350_00);
    expect(await postgresErrorCodeOf(setRates(0, null))).toBe(CHECK_VIOLATION);
    expect(await postgresErrorCodeOf(setRates(70_00, -1))).toBe(CHECK_VIOLATION);
  });

  it("refuses a block rental without its terms, and a short hire with no booked blocks", async () => {
    const noGrace = await postgresErrorCodeOf(addBlockRental({ graceMinutes: null }));
    const shortHireUnbooked = await postgresErrorCodeOf(
      addBlockRental({ isLongTerm: false, bookedBlocks: null }),
    );
    const waivedShortHire = await postgresErrorCodeOf(
      addBlockRental({ isLongTerm: false, bookedBlocks: 3, dailyRateWaivedReason: "Kind" }),
    );
    expect([noGrace, shortHireUnbooked, waivedShortHire]).toEqual([
      CHECK_VIOLATION,
      CHECK_VIOLATION,
      CHECK_VIOLATION,
    ]);
  });

  it("keeps a rental's block terms fixed, but lets the waiver reason be set", async () => {
    const rentalId = await addBlockRental();
    const changeTerms = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.update(schema.rentals).set({ graceMinutes: 120 }).where(eq(schema.rentals.id, rentalId)),
      ),
    );
    await withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.rentals)
        .set({ dailyRateWaivedReason: "Family emergency" })
        .where(eq(schema.rentals.id, rentalId)),
    );
    expect(changeTerms).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("starts each block rate from a block, once, with its daily rate", async () => {
    const rentalId = await addBlockRental();
    const addRate = (values: Partial<typeof schema.rentalRates.$inferInsert>) =>
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.rentalRates).values({
          operatorId: operatorAId,
          rentalId,
          dailyRateCents: 70_00,
          weeklyRateCents: 350_00,
          appliesFromBlock: 0,
          ...values,
        }),
      );

    await addRate({});
    const sameWeek = await postgresErrorCodeOf(addRate({ weeklyRateCents: 380_00 }));
    const noDaily = await postgresErrorCodeOf(
      addRate({ appliesFromBlock: 7, dailyRateCents: null }),
    );
    const bothStarts = await postgresErrorCodeOf(
      addRate({ appliesFromBlock: 14, appliesFrom: "2026-12-19" }),
    );
    await addRate({ appliesFromBlock: 7, weeklyRateCents: 400_00 });
    expect([sameWeek, noDaily, bothStarts]).toEqual([
      UNIQUE_VIOLATION,
      CHECK_VIOLATION,
      CHECK_VIOLATION,
    ]);
  });

  it("charges a block period once, refuses an overlap, and takes any number of corrections", async () => {
    const rentalId = await addBlockRental();
    await addBlockLine(rentalId, 0, 7);
    const twice = await postgresErrorCodeOf(addBlockLine(rentalId, 0, 7));
    const overlapping = await postgresErrorCodeOf(addBlockLine(rentalId, 3, 10));
    await addBlockLine(rentalId, 7, 14);
    await addBlockLine(rentalId, 0, 7, {
      kind: "credit",
      amountCents: 200_00,
      gstCents: 18_18,
      isCorrection: true,
    });
    await addBlockLine(rentalId, 0, 7, {
      amountCents: 60_00,
      gstCents: 5_45,
      isCorrection: true,
    });
    // The overlap trigger refuses a repeat before the unique index is reached; both stop it.
    expect([twice, overlapping]).toEqual([EXCLUSION_VIOLATION, EXCLUSION_VIOLATION]);
  });

  it("refuses a correction without its period, and a line with both kinds of period", async () => {
    const rentalId = await addBlockRental();
    const loose = await postgresErrorCodeOf(
      addBlockLine(rentalId, 0, 7, {
        isCorrection: true,
        periodStartsAt: null,
        periodEndsAt: null,
      }),
    );
    const both = await postgresErrorCodeOf(
      addBlockLine(rentalId, 0, 7, { periodStart: "2026-12-05", periodEnd: "2026-12-12" }),
    );
    expect([loose, both]).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
  });

  it("keeps one business's block rates and corrections from another", async () => {
    const rentalId = await addBlockRental();
    await addBlockLine(rentalId, 0, 7, { kind: "credit", isCorrection: true });
    const seenByB = await withTenant(web.db, operatorBId, async (tx) => ({
      rates: await tx.select().from(schema.rentalRates),
      lines: await tx.select().from(schema.ledgerLines),
      rentals: await tx.select().from(schema.rentals),
    }));
    const adminReads = await postgresErrorCodeOf(admin.db.select().from(schema.ledgerLines));

    expect(seenByB).toEqual({ rates: [], lines: [], rentals: [] });
    expect(adminReads).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
