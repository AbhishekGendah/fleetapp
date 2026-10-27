import { describe, expect, it } from "vitest";

import { getSetupChecklist, isSetupComplete, type SetupChecklistInput } from "./setup-checklist";

const NEW_OPERATOR: SetupChecklistInput = {
  legalName: "Test Rentals Pty Ltd",
  abn: null,
  addressLine1: null,
  suburb: null,
  state: null,
  postcode: null,
  phone: null,
  email: null,
  stripeChargesEnabled: false,
};

const FULL_DETAILS: SetupChecklistInput = {
  ...NEW_OPERATOR,
  abn: "51824753556",
  addressLine1: "1 Example Street",
  suburb: "Perth",
  state: "WA",
  postcode: "6000",
  phone: "0400 000 000",
  email: "hello@example.test",
};

const statusOf = (input: SetupChecklistInput, key: string) =>
  getSetupChecklist(input).find((step) => step.key === key)?.status;

describe("the setup checklist", () => {
  it("starts with everything to do", () => {
    const steps = getSetupChecklist(NEW_OPERATOR);

    expect(steps.map((step) => step.status)).toEqual(["to_do", "to_do", "to_do", "to_do"]);
    expect(isSetupComplete(steps)).toBe(false);
  });

  it("counts business details done only when every part is filled in", () => {
    expect(statusOf(FULL_DETAILS, "business_details")).toBe("done");
    expect(statusOf({ ...FULL_DETAILS, phone: null }, "business_details")).toBe("to_do");
    expect(statusOf({ ...FULL_DETAILS, suburb: "   " }, "business_details")).toBe("to_do");
  });

  it("counts Stripe done once charges are enabled", () => {
    expect(statusOf({ ...NEW_OPERATOR, stripeChargesEnabled: true }, "stripe")).toBe("done");
  });

  it("is complete only when every step is done", () => {
    expect(isSetupComplete([{ key: "stripe", status: "done" }])).toBe(true);
    expect(
      isSetupComplete([
        { key: "stripe", status: "done" },
        { key: "contract_template", status: "to_do" },
      ]),
    ).toBe(false);
  });
});
