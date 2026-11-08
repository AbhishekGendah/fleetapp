import { describe, expect, it } from "vitest";

import {
  atHandoverFact,
  bondFact,
  handoverFact,
  hasRenterProblem,
  nextRentFact,
  nextStepOf,
  owingFact,
  rentalStatusWords,
  rentFact,
  type BondFactInput,
  type NextStepInput,
} from "./rental-page-facts";

const TIME_ZONE = "Australia/Perth";
/** Fri 6 Nov 2026, 10:00 am in Perth. */
const NOW = new Date("2026-11-06T02:00:00Z");
const CLOCK = { timeZone: TIME_ZONE, now: NOW };
const TODAY = "2026-11-06";

describe("a rental's status in plain words", () => {
  const at = (status: Parameters<typeof rentalStatusWords>[0]["status"], start: string) =>
    rentalStatusWords({ status, plannedStart: new Date(start), handedOverAt: null }, CLOCK);

  it("says when a booking is handed over: today, or its day", () => {
    expect(at("booked", "2026-11-06T09:00:00Z")).toEqual({
      text: "Booked · handover today",
      tone: "booked",
    });
    expect(at("booked", "2026-11-09T01:00:00Z").text).toBe("Booked · handover Mon 9 Nov");
  });

  it("reads the day on the Operator's clock, not UTC", () => {
    // 4 pm UTC on the 6th is already the 7th in Perth.
    expect(at("booked", "2026-11-06T16:30:00Z").text).toBe("Booked · handover Sat 7 Nov");
  });

  it("says since when a rental is out", () => {
    const words = rentalStatusWords(
      {
        status: "active",
        plannedStart: new Date("2026-11-03T01:00:00Z"),
        handedOverAt: new Date("2026-11-03T01:12:00Z"),
      },
      CLOCK,
    );
    expect(words).toEqual({ text: "Out since Tue 3 Nov", tone: "out" });
  });

  it("calls a returned rental To close, and the rest by their own names", () => {
    expect(at("returned", "2026-11-01T01:00:00Z")).toEqual({ text: "To close", tone: "attention" });
    expect(at("draft", "2026-11-01T01:00:00Z").text).toBe("Draft");
    expect(at("closed", "2026-11-01T01:00:00Z").text).toBe("Closed");
    expect(at("cancelled", "2026-11-01T01:00:00Z").text).toBe("Cancelled");
  });
});

describe("the facts on a rental's strip", () => {
  it("gives the handover's day and time", () => {
    expect(handoverFact(new Date("2026-11-06T02:00:00Z"), CLOCK)).toEqual({
      label: "Handover",
      value: "Today",
      note: "10:00 am",
    });
  });

  it("gives a long-term rate a week and a short hire's a day", () => {
    expect(rentFact({ weeklyRateCents: 35000, dailyRateCents: 7000, isLongTerm: true })).toEqual({
      label: "Rent",
      value: "$350.00",
      note: "a week",
    });
    expect(rentFact({ weeklyRateCents: null, dailyRateCents: 7000, isLongTerm: false })?.note).toBe(
      "a day",
    );
    expect(rentFact({ weeklyRateCents: null, dailyRateCents: null, isLongTerm: true })).toBeNull();
  });

  const bond = (changes: Partial<BondFactInput>): BondFactInput => ({
    requiredCents: 50000,
    heldCents: 0,
    owingCents: 50000,
    onItsWayCents: 0,
    movements: [],
    isHandedOver: false,
    ...changes,
  });

  it("says whether the bond is paid, part paid, on its way or not paid", () => {
    expect(bondFact(bond({ heldCents: 50000, owingCents: 0 }))).toEqual({
      label: "Bond",
      value: "$500.00",
      note: "Paid",
    });
    expect(bondFact(bond({ heldCents: 20000, owingCents: 30000 })).note).toBe(
      "$300.00 still to pay",
    );
    expect(bondFact(bond({ onItsWayCents: 50000 })).note).toBe("On its way");
    expect(bondFact(bond({})).note).toBe("Not paid yet");
  });

  it("says Held once the car is out, and Refunded once it is back to the Renter", () => {
    expect(bondFact(bond({ heldCents: 50000, owingCents: 0, isHandedOver: true })).note).toBe(
      "Held",
    );
    const refunded = bond({
      owingCents: 0,
      isHandedOver: true,
      movements: [
        { id: "in", kind: "received", reversesId: null },
        { id: "out", kind: "refunded", reversesId: null },
      ],
    });
    expect(bondFact(refunded)).toEqual({ label: "Bond", value: "$500.00", note: "Refunded" });
  });

  it("ignores a refund that was itself corrected", () => {
    const corrected = bond({
      movements: [
        { id: "out", kind: "refunded", reversesId: null },
        { id: "fix", kind: "reversal", reversesId: "out" },
      ],
    });
    expect(bondFact(corrected).note).toBe("Not paid yet");
  });

  it("says None when the rental has no bond", () => {
    expect(bondFact(bond({ requiredCents: 0, owingCents: 0 }))).toEqual({
      label: "Bond",
      value: "None",
    });
  });

  it("says what is owing from the ledger's balance, all paid up, or in credit", () => {
    expect(owingFact({ balanceCents: 0, oldestOwingOn: null }, TODAY)).toEqual({
      label: "Owing",
      value: "$0.00",
      note: "All paid up",
    });
    expect(owingFact({ balanceCents: 35000, oldestOwingOn: "2026-11-03" }, TODAY)).toEqual({
      label: "Owing",
      value: "$350.00",
      note: "Since Tue 3 Nov",
    });
    expect(owingFact({ balanceCents: -2000, oldestOwingOn: null }, TODAY).note).toBe(
      "$20.00 in credit",
    );
  });

  it("gives the kilometres and fuel at handover, or nothing before a reading", () => {
    expect(atHandoverFact({ odometerKm: 24310, fuelLevel: "full" })).toEqual({
      label: "At handover",
      value: "24,310 km",
      note: "Fuel full",
    });
    expect(atHandoverFact({ odometerKm: null, fuelLevel: null })).toBeNull();
  });
});

describe("the next rent on a rental's strip", () => {
  it("says the amount and its day on the Operator's clock", () => {
    // 5 pm UTC on 12 Nov is already Fri 13 Nov in Perth.
    expect(
      nextRentFact(
        { chargedAt: new Date("2026-11-12T17:00:00Z"), amountCents: 350_00, isFirst: false },
        CLOCK,
      ),
    ).toEqual({ label: "Next rent", value: "$350.00", note: "Fri 13 Nov" });
  });

  it("calls a booking's first rent so, and says today when it is today", () => {
    expect(nextRentFact({ chargedAt: NOW, amountCents: 210_00, isFirst: true }, CLOCK)).toEqual({
      label: "First rent",
      value: "$210.00",
      note: "Today",
    });
  });
});

describe("the next step before handover", () => {
  const ready: NextStepInput = {
    status: "booked",
    isContractSigned: true,
    isBondPaid: true,
    isDetailsApproved: true,
    isDriverNamed: true,
    isHandoverAllowed: true,
    isHandoverUnderWay: false,
  };

  it("books a draft first", () => {
    expect(nextStepOf({ ...ready, status: "draft" }).main).toBe("book");
  });

  it("starts the handover when everything is in, or carries on with one under way", () => {
    expect(nextStepOf(ready)).toEqual({ main: "start_handover", canStartHandoverToo: false });
    expect(nextStepOf({ ...ready, isHandoverUnderWay: true, isContractSigned: false }).main).toBe(
      "continue_handover",
    );
  });

  it("asks for the first missing thing, in order, with Start handover still offered", () => {
    const missingAll = {
      ...ready,
      isContractSigned: false,
      isBondPaid: false,
      isDetailsApproved: false,
      isHandoverAllowed: false,
    };
    expect(nextStepOf(missingAll)).toEqual({ main: "send_contract", canStartHandoverToo: true });
    expect(nextStepOf({ ...missingAll, isContractSigned: true }).main).toBe("take_bond");
    expect(nextStepOf({ ...missingAll, isContractSigned: true, isBondPaid: true }).main).toBe(
      "check_details",
    );
  });

  it("names a business's driver after the contract and bond, never offering a handover to nobody", () => {
    const noDriver = { ...ready, isDriverNamed: false, isHandoverAllowed: false };
    expect(nextStepOf(noDriver)).toEqual({ main: "name_driver", canStartHandoverToo: false });
    expect(nextStepOf({ ...noDriver, isContractSigned: false })).toEqual({
      main: "send_contract",
      canStartHandoverToo: false,
    });
    expect(nextStepOf({ ...noDriver, isDetailsApproved: false }).main).toBe("name_driver");
  });

  it("asks for the contract even when nothing else stands in the way", () => {
    expect(nextStepOf({ ...ready, isContractSigned: false }).main).toBe("send_contract");
  });

  it("starts the handover when the ticks are in but another problem needs a reason there", () => {
    expect(nextStepOf({ ...ready, isHandoverAllowed: false })).toEqual({
      main: "start_handover",
      canStartHandoverToo: false,
    });
  });

  it("counts only the Renter's own problems against their details", () => {
    expect(hasRenterProblem([{ code: "details_missing", level: "handover", missing: [] }])).toBe(
      true,
    );
    expect(hasRenterProblem([{ code: "no_insurance", level: "handover", coverOn: TODAY }])).toBe(
      false,
    );
  });
});
