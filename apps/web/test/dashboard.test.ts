import { dashboardWindow } from "@fleetapp/core";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { loadOpenDamage } from "../src/lib/damage/damage-queries";
import { attentionList } from "../src/lib/dashboard/attention-items";
import { loadAttentionSources } from "../src/lib/dashboard/attention-sources";
import { loadBondsToRefund } from "../src/lib/dashboard/bonds-to-refund";
import {
  DASHBOARD_LIST_LENGTH,
  loadFleetCounts,
  loadLicencesDue,
  loadPaperworkDue,
  loadReviewsWaiting,
  loadWorkshopLate,
  MOST_OF_A_KIND,
} from "../src/lib/dashboard/fleet-overview";
import { loadBookingReadiness, loadRentalsThisWeek } from "../src/lib/dashboard/rentals-this-week";
import type { DemoContext } from "../src/lib/demo-data/demo-context";
import { seedOperatorWithUser } from "./car-fixtures";
import { demoTestContext, runEveryDemoStep, WHOLE_DEMO_RUN_MS } from "./demo-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

const WARNING_DAYS = 30;

/**
 * The dashboard over the demo business, whose rentals are known: R13 and
 * R14 overdue, six bookings starting this week (R16 and R22 not ready), and
 * so on (src/lib/demo-data/demo-plan.ts).
 */
describe("the dashboard", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let context: DemoContext;

  const clock = () => ({ timeZone: TEST_TIME_ZONE, now: new Date() });
  const window = () => dashboardWindow(new Date(), TEST_TIME_ZONE);

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Dashboard Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Dashboard Rentals Pty Ltd");
    context = await demoTestContext(web, actor);
    await runEveryDemoStep(context);
  }, WHOLE_DEMO_RUN_MS);

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("lists the rentals with something happening this week, overdue first", async () => {
    const thisWeek = await loadRentalsThisWeek(web.db, actor.operatorId, window(), clock());

    expect(
      thisWeek.filter((rental) => rental.moment === "overdue").map((rental) => rental.rego),
    ).toEqual(["DEMO14", "DEMO13"]);
    expect(thisWeek[0]?.moment).toBe("overdue");
    // R17 starts at 5pm today: a pickup today, or late once 5pm has passed.
    const starting = thisWeek.filter((rental) =>
      ["pickup_today", "late_pickup", "starting_this_week"].includes(rental.moment),
    );
    expect(starting.map((rental) => rental.rego).sort()).toEqual(
      ["DEMO15", "DEMO16", "DEMO17", "DEMO21", "DEMO22", "DEMO32"].sort(),
    );
    expect(thisWeek).toHaveLength(8);
  });

  it("says which of this week's bookings are not ready, and why", async () => {
    const thisWeek = await loadRentalsThisWeek(web.db, actor.operatorId, window(), clock());
    const readiness = await loadBookingReadiness(web.db, actor.operatorId, thisWeek, clock());
    const regoOf = (rentalId: string) => thisWeek.find((rental) => rental.id === rentalId)?.rego;
    const blockers = Object.fromEntries(
      readiness.map((booking) => [
        regoOf(booking.rentalId),
        booking.blockers.map((blocker) => blocker.code),
      ]),
    );

    expect(blockers).toEqual({
      DEMO16: ["contract_unsigned", "bond_short"],
      DEMO22: ["contract_unsigned", "car_not_ready", "bond_short"],
    });
  });

  it("counts the fleet by status", async () => {
    expect(await loadFleetCounts(web.db, actor.operatorId)).toEqual({
      available: 24,
      rented: 14,
      in_service: 6,
      off_road: 2,
      sold: 2,
      written_off: 1,
    });
  });

  it("merges every kind into one list, the dashboard's few picking the same top five as the whole", async () => {
    const load = (limitPerKind: number) =>
      loadAttentionSources(web.db, actor.operatorId, { clock: clock(), limitPerKind });
    const whole = attentionList(await load(MOST_OF_A_KIND), TEST_TIME_ZONE);
    const few = attentionList(await load(DASHBOARD_LIST_LENGTH), TEST_TIME_ZONE);

    expect(whole.items).toHaveLength(whole.total);
    expect(whole.total).toBeGreaterThan(DASHBOARD_LIST_LENGTH);
    expect(few.total).toBe(whole.total);
    const topKeys = (list: typeof whole) =>
      list.items.slice(0, DASHBOARD_LIST_LENGTH).map((item) => item.key);
    expect(topKeys(few)).toEqual(topKeys(whole));
    expect(whole.items[0]?.urgency).toBe("red");
    const overdue = whole.items.filter((item) => item.kind === "overdue_return");
    expect(overdue.map((item) => item.more.at(-1))).toEqual([
      expect.objectContaining({ text: "DEMO14" }),
      expect.objectContaining({ text: "DEMO13" }),
    ]);
    expect(whole.items.map((item) => item.kind)).not.toContain("claims_under_way");
  });

  it("lists rego and insurance due, licences due of Renters renting, and nothing late or waiting", async () => {
    const expiry = { today: window().today, warningDays: WARNING_DAYS };
    const paperwork = await loadPaperworkDue(web.db, actor.operatorId, expiry);
    const licences = await loadLicencesDue(web.db, actor.operatorId, expiry);

    expect(paperwork.total).toBeGreaterThan(0);
    expect(paperwork.items.map((car) => car.rego)).not.toContain("DEMO46");
    expect(licences.items.map((renter) => renter.fullName)).toEqual(["Ethan Walker"]);
    expect((await loadWorkshopLate(web.db, actor.operatorId, expiry.today)).total).toBe(0);
    expect((await loadReviewsWaiting(web.db, actor.operatorId)).total).toBe(0);
  });

  it("shows another Operator none of it", async () => {
    const expiry = { today: window().today, warningDays: WARNING_DAYS };
    const other = otherOperator.operatorId;
    expect(await loadRentalsThisWeek(web.db, other, window(), clock())).toEqual([]);
    expect(await loadFleetCounts(web.db, other)).toEqual({});
    expect((await loadOpenDamage(web.db, other)).total).toBe(0);
    expect((await loadBondsToRefund(web.db, other)).total).toBe(0);
    expect((await loadReviewsWaiting(web.db, other)).total).toBe(0);
    expect((await loadWorkshopLate(web.db, other, expiry.today)).total).toBe(0);
    const sources = await loadAttentionSources(web.db, other, {
      clock: clock(),
      limitPerKind: MOST_OF_A_KIND,
    });
    expect(attentionList(sources, TEST_TIME_ZONE)).toEqual({ items: [], total: 0 });
    expect((await loadPaperworkDue(web.db, other, expiry)).total).toBe(0);
    expect((await loadLicencesDue(web.db, other, expiry)).total).toBe(0);
  });
});
