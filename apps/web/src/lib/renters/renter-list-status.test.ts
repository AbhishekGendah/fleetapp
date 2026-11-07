import { describe, expect, it } from "vitest";

import {
  renterBadges,
  renterListFilterOf,
  renterOverdueOf,
  type RenterStanding,
} from "./renter-list-status";

function standing(changes: Partial<RenterStanding> = {}): RenterStanding {
  return {
    status: "active",
    isArchived: false,
    isRentingNow: false,
    isBooked: false,
    isWaitingReview: false,
    licenceStatus: "current",
    isOverdue: false,
    isBondToRefund: false,
    ...changes,
  };
}

const texts = (changes: Partial<RenterStanding>) =>
  renterBadges(standing(changes)).map((badge) => badge.text);

describe("a Renter's labels", () => {
  it("says renting, booked or not renting", () => {
    expect(texts({ isRentingNow: true, isBooked: true })).toEqual(["Renting"]);
    expect(texts({ isBooked: true })).toEqual(["Booked"]);
    expect(texts({})).toEqual(["Not renting"]);
  });

  it("adds what needs a look after it, and leaves out Not renting when there is any", () => {
    expect(texts({ isRentingNow: true, isOverdue: true })).toEqual(["Renting", "Overdue"]);
    expect(texts({ isBooked: true, isWaitingReview: true })).toEqual(["Booked", "To review"]);
    expect(texts({ status: "do_not_rent" })).toEqual(["Do not rent"]);
    expect(texts({ isBondToRefund: true })).toEqual(["To refund"]);
  });

  it("names a licence due or expired only while the Renter has a car or one booked", () => {
    expect(texts({ isRentingNow: true, licenceStatus: "due_soon" })).toEqual([
      "Renting",
      "Licence due",
    ]);
    expect(texts({ isBooked: true, licenceStatus: "expired" })).toEqual([
      "Booked",
      "Licence expired",
    ]);
    expect(texts({ licenceStatus: "expired" })).toEqual(["Not renting"]);
  });

  it("makes Do not rent the darkest label, and Archived the only one", () => {
    expect(renterBadges(standing({ status: "do_not_rent" }))[0]?.tone).toBe("refused");
    expect(texts({ isArchived: true, isRentingNow: true, isOverdue: true })).toEqual(["Archived"]);
  });
});

describe("the Renters list's filters", () => {
  it("takes its own plain words", () => {
    expect(renterListFilterOf("renting")).toBe("renting");
    expect(renterListFilterOf("to-review")).toBe("to-review");
    expect(renterListFilterOf(undefined)).toBeUndefined();
    expect(renterListFilterOf("nonsense")).toBeUndefined();
  });

  it("opens the filter that holds an old address's value", () => {
    expect(renterListFilterOf("waiting_review")).toBe("to-review");
    expect(renterListFilterOf("do_not_rent")).toBe("do-not-rent");
    // Active meant everyone not marked Do not rent: All now.
    expect(renterListFilterOf("active")).toBe("");
  });
});

describe("whether a Renter is overdue", () => {
  const TODAY = "2026-11-10";
  const charge = (id: string, rentalId: string, effectiveOn: string, amountCents: number) => ({
    id,
    rentalId,
    kind: "charge" as const,
    amountCents,
    reversesId: null,
    effectiveOn,
  });

  it("works out each rental on its own, and gives the longest late", () => {
    const overdue = renterOverdueOf(
      [charge("a", "one", "2026-11-05", 100_00), charge("b", "two", "2026-11-01", 50_00)],
      TODAY,
      2,
    );
    expect(overdue).toMatchObject({ daysLate: 9, oldestDueOn: "2026-11-01", overdueCents: 50_00 });
  });

  it("never lets credit on one rental hide another's arrears", () => {
    const credit = {
      id: "c",
      rentalId: "one",
      kind: "payment" as const,
      amountCents: 500_00,
      reversesId: null,
      effectiveOn: "2026-11-01",
    };
    expect(
      renterOverdueOf([credit, charge("b", "two", "2026-11-01", 50_00)], TODAY, 2),
    ).toMatchObject({ daysLate: 9 });
  });

  it("is not overdue inside the grace days, or with nothing owing", () => {
    expect(renterOverdueOf([charge("a", "one", "2026-11-08", 100_00)], TODAY, 2)).toBeNull();
    expect(renterOverdueOf([], TODAY, 2)).toBeNull();
  });
});
