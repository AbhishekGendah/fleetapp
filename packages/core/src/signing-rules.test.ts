import { describe, expect, it } from "vitest";

import { blockStartsAt } from "./rent-blocks";
import { changeSigningProblem, isContractSignable, type SignableChange } from "./signing-rules";

const HANDED_OVER = new Date("2027-01-04T01:00:00Z");
const OUT = { status: "active" as const, handedOverAt: HANDED_OVER };

function change(overrides: Partial<SignableChange> = {}): SignableChange {
  return {
    id: "a",
    kind: "end_date",
    status: "applied",
    documentId: null,
    appliesFromBlock: null,
    createdAt: new Date("2027-01-10T00:00:00Z"),
    ...overrides,
  };
}

describe("when a contract or change can be sent and signed (review A3-15)", () => {
  it("signs a contract only before the car goes out", () => {
    expect(["draft", "booked"].every((status) => isContractSignable(status as never))).toBe(true);
    expect(isContractSignable("active")).toBe(false);
  });

  it("refuses a withdrawn, signed, or finished rental's change", () => {
    const now = new Date("2027-01-11T00:00:00Z");
    expect(changeSigningProblem(change({ status: "withdrawn" }), OUT, [], now)).toBe("withdrawn");
    expect(changeSigningProblem(change({ documentId: "d" }), OUT, [], now)).toBe("signed");
    expect(
      changeSigningProblem(change(), { status: "returned", handedOverAt: HANDED_OVER }, [], now),
    ).toBe("rental_over");
    expect(changeSigningProblem(change(), OUT, [], now)).toBeNull();
  });

  it("refuses a rate change once its rent week has begun (review A3-1)", () => {
    const rate = change({
      kind: "weekly_rate",
      status: "waiting_for_signature",
      appliesFromBlock: 3,
    });
    const weekStart = blockStartsAt(HANDED_OVER, 3);
    expect(changeSigningProblem(rate, OUT, [], new Date(weekStart.getTime() - 1))).toBeNull();
    expect(changeSigningProblem(rate, OUT, [], weekStart)).toBe("out_of_time");
    // A rise for a direct-debit Renter moves to a later week when signed late instead.
    expect(
      changeSigningProblem(rate, { ...OUT, isStartMovedBySigning: true }, [], weekStart),
    ).toBeNull();
  });

  it("refuses an end change a later one replaced, but not one a withdrawn change came after (review A3-12)", () => {
    const now = new Date("2027-01-20T00:00:00Z");
    const later = { ...change({ id: "b", kind: "make_ongoing" as const }), createdAt: now };
    expect(changeSigningProblem(change(), OUT, [later], now)).toBe("replaced");
    expect(
      changeSigningProblem(change(), OUT, [{ ...later, status: "withdrawn" }], now),
    ).toBeNull();
    expect(changeSigningProblem(later, OUT, [change()], now)).toBeNull();
  });
});
