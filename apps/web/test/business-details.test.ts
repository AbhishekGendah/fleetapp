import { randomUUID } from "node:crypto";

import { activityLog, operators } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { loadBusinessDetails, saveBusinessDetails } from "../src/lib/settings/business-details";
import {
  businessDetailsInputSchema,
  parseBusinessDetailsForm,
  type BusinessDetailsInput,
} from "../src/lib/settings/business-details-input";

const COMPLETE_FORM = {
  legalName: "Test Rentals Pty Ltd",
  tradingName: "",
  abn: "51 824 753 556",
  gstRegistered: true,
  gstRegisteredFrom: "2024-07-01",
  addressLine1: "1 Example Street",
  addressLine2: "",
  suburb: "Perth",
  state: "WA",
  postcode: "6000",
  phone: "(08) 9123 4567",
  email: "hello@example.test",
  timezone: "Australia/Perth",
};

function errorsFor(form: Record<string, unknown>): Record<string, string[] | undefined> {
  const result = businessDetailsInputSchema.safeParse(form);
  if (result.success) {
    return {};
  }
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join("."), [issue.message]]),
  );
}

describe("the business details form's rules", () => {
  it("accepts a complete form, storing the ABN as digits and blanks as empty", () => {
    const parsed = businessDetailsInputSchema.parse(COMPLETE_FORM);

    expect(parsed.abn).toBe("51824753556");
    expect(parsed.tradingName).toBeNull();
    expect(parsed.addressLine2).toBeNull();
  });

  it("lets everything but the legal name wait until later", () => {
    const parsed = businessDetailsInputSchema.safeParse({
      ...COMPLETE_FORM,
      abn: "",
      gstRegistered: false,
      gstRegisteredFrom: "",
      addressLine1: "",
      suburb: "",
      state: null,
      postcode: "",
      phone: "",
      email: "",
    });

    expect(parsed.success).toBe(true);
    expect(errorsFor({ ...COMPLETE_FORM, legalName: "  " })).toHaveProperty("legalName");
  });

  it("refuses an ABN that fails the ATO check", () => {
    expect(errorsFor({ ...COMPLETE_FORM, abn: "51 824 753 557" })).toHaveProperty("abn");
  });

  it("needs a GST date when registered, and refuses one from before GST", () => {
    expect(errorsFor({ ...COMPLETE_FORM, gstRegisteredFrom: "" })).toHaveProperty(
      "gstRegisteredFrom",
    );
    expect(errorsFor({ ...COMPLETE_FORM, gstRegisteredFrom: "1999-06-30" })).toHaveProperty(
      "gstRegisteredFrom",
    );
  });

  it("refuses a timezone outside Australia, a bad postcode, phone or email", () => {
    const errors = errorsFor({
      ...COMPLETE_FORM,
      timezone: "Europe/London",
      postcode: "600",
      phone: "call me",
      email: "not-an-email",
    });

    expect(Object.keys(errors).sort()).toEqual(["email", "phone", "postcode", "timezone"]);
  });

  it("stores a phone number in the usual format, whatever way it was typed", () => {
    const parsed = businessDetailsInputSchema.parse({ ...COMPLETE_FORM, phone: "+61 412345678" });

    expect(parsed.phone).toBe("0412 345 678");
    expect(errorsFor({ ...COMPLETE_FORM, phone: "0412 345" })).toHaveProperty("phone");
  });

  it("ignores a GST date left in the hidden box after unticking GST", () => {
    const { gstRegistered: _ignored, ...values } = COMPLETE_FORM;
    const parsed = parseBusinessDetailsForm(values, false);

    expect(parsed.success && parsed.data.gstRegisteredFrom).toBeNull();
  });

  it("refuses a name that spans lines", () => {
    expect(errorsFor({ ...COMPLETE_FORM, legalName: "Test\nRentals" })).toHaveProperty("legalName");
  });
});

describe("saving business details", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let operatorId: string;
  const userId = randomUUID();

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    const [operator] = await admin.db
      .insert(operators)
      .values({ legalName: "Before Pty Ltd" })
      .returning({ id: operators.id });
    operatorId = operator!.id;
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  const parse = (form: Record<string, unknown>): BusinessDetailsInput =>
    businessDetailsInputSchema.parse(form);

  async function historyLines() {
    return admin.db
      .select({ valuesBefore: activityLog.valuesBefore, valuesAfter: activityLog.valuesAfter })
      .from(activityLog)
      .where(and(eq(activityLog.operatorId, operatorId), eq(activityLog.action, "updated")));
  }

  it("saves the details and logs only what changed, before and after", async () => {
    await saveBusinessDetails(web.db, { userId, operatorId }, parse(COMPLETE_FORM));

    const details = await loadBusinessDetails(web.db, operatorId);
    expect(details?.abn).toBe("51824753556");
    expect(details?.gstRegisteredFrom).toBe("2024-07-01");

    const [line] = await historyLines();
    expect(line?.valuesBefore).toMatchObject({ legalName: "Before Pty Ltd", abn: null });
    expect(line?.valuesAfter).toMatchObject({
      legalName: "Test Rentals Pty Ltd",
      abn: "51824753556",
    });
    expect(line?.valuesAfter).not.toHaveProperty("timezone");
  });

  it("writes nothing to the history when nothing changed", async () => {
    const before = await historyLines();

    await saveBusinessDetails(web.db, { userId, operatorId }, parse(COMPLETE_FORM));

    expect(await historyLines()).toHaveLength(before.length);
  });

  it("saves a postcode that does not suit the state, with a warning", async () => {
    const result = await saveBusinessDetails(
      web.db,
      { userId, operatorId },
      parse({ ...COMPLETE_FORM, postcode: "2000" }),
    );

    expect(result.hasPostcodeWarning).toBe(true);
    expect((await loadBusinessDetails(web.db, operatorId))?.postcode).toBe("2000");
  });
});
