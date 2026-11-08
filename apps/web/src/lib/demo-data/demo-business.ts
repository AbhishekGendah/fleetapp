import { emptyBusinessRenterForm, parseBusinessRenterForm } from "../renters/business-renter-input";
import { addNote } from "../renters/notes";
import { addExistingDriver, removeDriver } from "../renters/organisation-driver-records";
import { createBusinessRenter } from "../renters/renter-records";
import { checkedInput, DemoDataError, expectSaved, type DemoContext } from "./demo-context";
import { findRenterId } from "./demo-renters";

/**
 * One demo business Renter with its drivers (plan slice 2), so the dev site
 * shows a business's page, its Drivers tab, a past driver and the "Driver
 * for" labels. Its drivers are demo person Renters added in the steps
 * before; nothing is booked for it yet (renting to a business is slice 3).
 * The ABN is the ATO's own example; the phone is one the regulator keeps
 * for fiction.
 */
const DEMO_BUSINESS = {
  fullName: "Acme Rideshare Pty Ltd",
  tradingName: "Acme Rides",
  abn: "51 824 753 556",
  contactName: "Dana Wells",
  email: "dana.wells@example.test",
  phone: "0491 576 398",
  businessAddress: "Unit 4, 12 Example Road, Osborne Park WA 6017",
};

const CURRENT_DRIVERS = ["Sam Taylor", "Victor Lee", "Hana Suzuki"] as const;
/** Added and then removed, so the page shows a past driver. */
const PAST_DRIVER = "Wei Zhang";
const NOTE = "Fleet of rideshare drivers in Osborne Park. Dana prefers email.";

async function demoRenterId(context: DemoContext, fullName: string): Promise<string> {
  const id = await findRenterId(context, fullName);
  if (!id) {
    throw new DemoDataError(`Demo driver ${fullName} is missing: add the Renters first.`);
  }
  return id;
}

async function addDriver(context: DemoContext, businessId: string, fullName: string) {
  const result = await addExistingDriver(
    context.deps.database,
    context.actor,
    businessId,
    await demoRenterId(context, fullName),
  );
  expectSaved(result.status, ["added"], `driver ${fullName}`);
}

export async function addDemoBusiness(context: DemoContext): Promise<number> {
  if (await findRenterId(context, DEMO_BUSINESS.fullName)) {
    return 0;
  }
  const input = checkedInput(
    parseBusinessRenterForm({ ...emptyBusinessRenterForm(), ...DEMO_BUSINESS }),
    "business Renter",
  );
  const { database } = context.deps;
  const businessId = await createBusinessRenter(database, context.actor, input);
  expectSaved(await addNote(database, context.actor, businessId, NOTE), ["added"], "business note");
  for (const fullName of [...CURRENT_DRIVERS, PAST_DRIVER]) {
    await addDriver(context, businessId, fullName);
  }
  expectSaved(
    await removeDriver(
      database,
      context.actor,
      businessId,
      await demoRenterId(context, PAST_DRIVER),
    ),
    ["removed"],
    `removing driver ${PAST_DRIVER}`,
  );
  return 1;
}
