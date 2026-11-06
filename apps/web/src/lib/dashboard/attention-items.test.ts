import { describe, expect, it } from "vitest";

import { attentionList, attentionSearchText, type AttentionInput } from "./attention-items";
import type { CarPaperworkDue } from "./fleet-overview";

const TIME_ZONE = "Australia/Sydney";
const TODAY = "2026-11-06";
const WARNING_DAYS = 30;

const none = { total: 0, items: [] };

function input(changes: Partial<AttentionInput>): AttentionInput {
  return {
    window: { today: TODAY },
    rentals: [],
    notReady: [],
    paperworkDue: none,
    workshopLate: none,
    licencesDue: none,
    reviewsWaiting: none,
    openDamage: none,
    bondsToRefund: none,
    vehicleWarningDays: WARNING_DAYS,
    ...changes,
  };
}

function rental(
  id: string,
  moment: AttentionInput["rentals"][number]["moment"],
  times: { start: string; end?: string },
): AttentionInput["rentals"][number] {
  return {
    id,
    moment,
    plannedStart: new Date(times.start),
    plannedEnd: times.end ? new Date(times.end) : null,
    renterId: `renter-${id}`,
    renterFullName: `Renter ${id}`,
    vehicleId: `car-${id}`,
    rego: `REGO${id}`,
  };
}

function car(id: string, changes: Partial<CarPaperworkDue>): CarPaperworkDue {
  return {
    id,
    rego: `CAR${id}`,
    make: "Toyota",
    model: "Corolla",
    isRegoOnDirectDebit: false,
    regoExpiresOn: "2027-06-01",
    insuranceEndsOn: "2027-06-01",
    isInsuredToday: true,
    isRegisteredToday: true,
    ...changes,
  };
}

const keysOf = (changes: Partial<AttentionInput>) =>
  attentionList(input(changes), TIME_ZONE).items.map((item) => item.key);

describe("the Needs attention list", () => {
  it("puts red before amber before blue, whatever has waited longest", () => {
    const keys = keysOf({
      reviewsWaiting: {
        total: 1,
        items: [{ id: "r1", fullName: "Riley Chen", sentAt: new Date("2026-01-01T00:00:00Z") }],
      },
      openDamage: {
        total: 1,
        items: [
          {
            id: "d1",
            vehicleId: "car-d1",
            rego: "DENT1",
            description: "Dent on bonnet",
            foundOn: "2026-02-01",
            claimStatus: null,
          },
        ],
      },
      rentals: [
        rental("1", "overdue", { start: "2026-10-01T00:00:00Z", end: "2026-11-05T00:00:00Z" }),
      ],
    });
    expect(keys).toEqual([
      "overdue_return-1",
      "damage_open-d1",
      "details_to_review-r1-1767225600000",
    ]);
  });

  it("puts the longest waiting first within a colour, dates and moments together", () => {
    const keys = keysOf({
      rentals: [
        rental("late", "overdue", { start: "2026-10-01T00:00:00Z", end: "2026-11-04T00:00:00Z" }),
        rental("later", "overdue", { start: "2026-10-01T00:00:00Z", end: "2026-11-05T03:00:00Z" }),
      ],
      paperworkDue: {
        total: 2,
        items: [
          car("expired", { regoExpiresOn: "2026-11-04", isRegisteredToday: false }),
          car("none", { insuranceEndsOn: null, isInsuredToday: false }),
        ],
      },
    });
    // No insurance on file has waited longest; 4 Nov (a date) comes before 11 am on 4 Nov in Sydney.
    expect(keys).toEqual([
      "paperwork-none",
      "paperwork-expired",
      "overdue_return-late",
      "overdue_return-later",
    ]);
  });

  it("compares moments on the Operator's day, not the server's", () => {
    // 1:30 pm UTC on 4 Nov is 12:30 am on 5 Nov in Sydney: after an expiry dated 4 Nov.
    const keys = keysOf({
      rentals: [
        rental("1", "overdue", { start: "2026-10-01T00:00:00Z", end: "2026-11-04T13:30:00Z" }),
      ],
      paperworkDue: {
        total: 1,
        items: [car("expired", { insuranceEndsOn: "2026-11-04", isInsuredToday: false })],
      },
    });
    expect(keys).toEqual(["paperwork-expired", "overdue_return-1"]);

    const [overdue] = attentionList(
      input({
        rentals: [
          rental("1", "overdue", { start: "2026-10-01T00:00:00Z", end: "2026-11-04T13:30:00Z" }),
        ],
      }),
      TIME_ZONE,
    ).items;
    expect(overdue?.fix.text).toBe("Due back Thu 5 Nov, 12:30 am");
    expect(overdue?.more).toEqual(["1 day late", { text: "REGO1", href: "/cars/car-1" }]);
  });

  it("counts every kind in the total, beyond the few loaded", () => {
    const list = attentionList(
      input({
        paperworkDue: { total: 12, items: [car("1", { regoExpiresOn: "2026-11-20" })] },
        bondsToRefund: {
          total: 3,
          items: [
            {
              rentalId: "b1",
              renterId: "renter-b1",
              vehicleId: "car-b1",
              rego: "BOND1",
              renterName: "Sam Patel",
              heldCents: 500_00,
              cancelledAt: new Date("2026-11-03T01:00:00Z"),
            },
          ],
        },
        rentals: [
          rental("1", "overdue", { start: "2026-10-01T00:00:00Z", end: "2026-11-05T00:00:00Z" }),
          rental("2", "pickup_today", { start: "2026-11-06T05:00:00Z" }),
        ],
      }),
      TIME_ZONE,
    );
    // The pickup today is ready, so it needs nothing.
    expect(list.total).toBe(12 + 3 + 1);
    expect(list.items).toHaveLength(3);
    const bond = list.items.find((item) => item.kind === "bond_to_refund");
    expect(bond).toMatchObject({
      label: "To refund",
      who: { text: "Sam Patel", href: "/renters/renter-b1" },
      fix: { text: "$500.00 bond to refund", href: "/rentals/b1" },
      more: ["cancelled Tue 3 Nov", { text: "BOND1", href: "/cars/car-b1" }],
    });
  });

  it("makes a handover today that is not ready red, and one later this week amber", () => {
    const list = attentionList(
      input({
        rentals: [
          rental("today", "pickup_today", { start: "2026-11-06T05:00:00Z" }),
          rental("later", "starting_this_week", { start: "2026-11-08T05:00:00Z" }),
          rental("late", "late_pickup", { start: "2026-11-05T23:00:00Z" }),
        ],
        notReady: ["today", "later", "late"].map((rentalId) => ({
          rentalId,
          blockers: [
            { code: "contract_unsigned" as const },
            {
              code: "bond_short" as const,
              level: "handover" as const,
              owingCents: 250_00,
              onItsWayCents: 0,
            },
          ],
        })),
      }),
      TIME_ZONE,
    );
    expect(list.items.map((item) => [item.key, item.urgency, item.label])).toEqual([
      ["late_pickup-late", "red", "Late"],
      ["not_ready-today", "red", "Not ready"],
      ["not_ready-later", "amber", "Not ready"],
    ]);
    expect(list.items[1]?.fix.text).toBe("Contract not signed, bond owing $250.00");
    expect(list.items[1]?.more[0]).toBe("Handover today, 4:00 pm");
    expect(list.items[0]?.fix.text).toBe("Handover was due today, 10:00 am");
  });

  it("labels rego and insurance missing, expired or due soon", () => {
    const labels = attentionList(
      input({
        paperworkDue: {
          total: 3,
          items: [
            car("missing", { insuranceEndsOn: null, isInsuredToday: false }),
            car("expired", { regoExpiresOn: "2026-11-01", isRegisteredToday: false }),
            car("due", { regoExpiresOn: "2026-11-12" }),
          ],
        },
      }),
      TIME_ZONE,
    ).items.map((item) => [item.who.text, item.urgency, item.label, item.fix.text]);
    expect(labels).toEqual([
      ["CARmissing", "red", "Missing", "No current insurance"],
      ["CARexpired", "red", "Expired", "Rego expired Sun 1 Nov"],
      ["CARdue", "amber", "Due soon", "Rego due Thu 12 Nov"],
    ]);
  });

  it("searches the words shown", () => {
    const [item] = attentionList(
      input({
        reviewsWaiting: {
          total: 1,
          items: [{ id: "r1", fullName: "Riley Chen", sentAt: new Date("2026-11-05T00:00:00Z") }],
        },
      }),
      TIME_ZONE,
    ).items;
    expect(item && attentionSearchText(item)).toBe(
      "Riley Chen · Sent their licence and contact details to approve · Sent Thu 5 Nov · To review",
    );
  });

  it("is empty when nothing needs attention", () => {
    expect(attentionList(input({}), TIME_ZONE)).toEqual({ items: [], total: 0 });
  });
});
