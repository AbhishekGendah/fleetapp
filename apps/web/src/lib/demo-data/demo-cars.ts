import { centsForEditing, gstIncludedIn, type AustralianStateCode } from "@fleetapp/core";
import { vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";

import { startCarPhotoUpload } from "../files/car-files";
import {
  emptyCostForm,
  emptyPurchaseForm,
  emptySaleForm,
  parseCostForm,
  parsePurchaseForm,
  parseSaleForm,
} from "../vehicles/cost-input";
import { addCost, savePurchase, saveSale } from "../vehicles/cost-records";
import { emptyRegoForm, parseRegoForm } from "../vehicles/paperwork-input";
import { addRegistration } from "../vehicles/registrations";
import {
  EMPTY_VEHICLE_FORM,
  parseNewVehicleForm,
  vehicleStatusInputSchema,
} from "../vehicles/vehicle-input";
import { archiveVehicle, changeVehicleStatus, createVehicle } from "../vehicles/vehicle-records";
import { DEMO_CAR_COUNT, DEMO_CAR_ROLES, demoRego, type DemoCarRole } from "./demo-plan";
import {
  checkedInput,
  dayFrom,
  expectSaved,
  momentText,
  type DemoContext,
  DemoDataError,
} from "./demo-context";
import { pictureFrom, plannedSizeOf, sendDemoPhoto } from "./demo-files";
import { DEMO_PICTURES } from "./demo-pictures";

interface DemoModel {
  make: string;
  model: string;
  variant: string;
  bodyType: string;
  fuelType: string;
  transmission: string;
  seats: number;
  priceCents: number;
}

/** Every demo car's prices: a short hire by the day, and the cheaper long-term week. */
export const DEMO_DAILY_RATE_CENTS = 70_00;
export const DEMO_LONG_TERM_WEEKLY_CENTS = 350_00;

/** Cars a rideshare and weekly-rental fleet runs, all in AGS's make and model list. */
const DEMO_MODELS: readonly DemoModel[] = [
  model("Toyota", "Camry", "Ascent Hybrid", "sedan", "hybrid", 5, 32_000_00),
  model("Toyota", "Corolla", "Ascent Sport Hybrid", "hatch", "hybrid", 5, 26_000_00),
  model("Toyota", "RAV4", "GX Hybrid", "suv", "hybrid", 5, 38_000_00),
  model("Kia", "Niro", "S Hybrid", "suv", "hybrid", 5, 30_000_00),
  model("Hyundai", "Ioniq", "Hybrid Elite", "hatch", "hybrid", 5, 24_000_00),
  model("Tesla", "Model 3", "Rear-Wheel Drive", "sedan", "electric", 5, 48_000_00),
  model("Tesla", "Model Y", "Long Range", "suv", "electric", 5, 58_000_00),
  model("MG", "ZS EV", "Excite", "suv", "electric", 5, 34_000_00),
  model("BYD", "Atto 3", "Extended Range", "suv", "electric", 5, 42_000_00),
  model("Kia", "Carnival", "S", "people_mover", "diesel", 8, 46_000_00),
  model("Toyota", "HiAce", "LWB", "van", "diesel", 3, 44_000_00),
  model("Toyota", "HiLux", "SR Double Cab", "ute", "diesel", 5, 45_000_00),
  model("Ford", "Ranger", "XLT", "ute", "diesel", 5, 52_000_00),
  model("Mazda", "CX-5", "Maxx Sport", "suv", "petrol", 5, 33_000_00),
  model("Mitsubishi", "Outlander", "ES PHEV", "suv", "plug_in_hybrid", 5, 47_000_00),
  model("Honda", "Civic", "VTi-LX", "hatch", "petrol", 5, 31_000_00),
  model("Suzuki", "Swift", "GL", "hatch", "petrol", 5, 19_000_00),
  model("Skoda", "Octavia", "110TSI Style", "wagon", "petrol", 5, 36_000_00),
  model("Volkswagen", "Golf", "110TSI Life", "hatch", "petrol", 5, 34_000_00),
  model("Nissan", "Leaf", "e+", "hatch", "electric", 5, 38_000_00),
  model("Polestar", "Polestar 2", "Standard Range", "sedan", "electric", 5, 55_000_00),
  model("Hyundai", "i30", "Active", "hatch", "petrol", 5, 23_000_00),
  model("Kia", "Cerato", "S", "sedan", "petrol", 5, 24_000_00),
  model("Toyota", "Kluger", "GX Hybrid", "suv", "hybrid", 7, 55_000_00),
  model("Mazda", "Mazda3", "G20 Pure", "hatch", "lpg", 5, 25_000_00),
];

function model(
  make: string,
  modelName: string,
  variant: string,
  bodyType: string,
  fuelType: string,
  seats: number,
  priceCents: number,
): DemoModel {
  // A van or ute in a rental fleet is as often manual as automatic.
  const transmission = bodyType === "van" ? "manual" : "automatic";
  return { make, model: modelName, variant, bodyType, fuelType, transmission, seats, priceCents };
}

const COLOURS = ["White", "Silver", "Grey", "Black", "Blue", "Red", "Green", "Pearl white"];
const STATES: readonly AustralianStateCode[] = ["WA", "WA", "WA", "NSW", "VIC", "QLD", "SA"];
const NEWEST_YEAR = 2025;
const YEARS_SPREAD = 10;
const KILOMETRES_PER_YEAR = 28_000;
const VIN_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const VIN_LENGTH = 17;
/** "DEM", not "DEMO": a VIN never has an O. */
const VIN_PREFIX = "DEM";
const VIN_SERIAL_DIGITS = 3;
/** One in this many cars is entered without a VIN, as happens when it is added in a hurry. */
const CARS_PER_MISSING_VIN = 8;

export interface DemoCar {
  number: number;
  rego: string;
  role: DemoCarRole;
  regoState: AustralianStateCode;
  model: DemoModel;
  year: number;
  colour: string;
  kilometres: number;
  vin: string | null;
}

/** A made-up but well-formed VIN: 17 letters and numbers, never I, O or Q. */
function demoVin(number: number): string {
  const serial = String(number).padStart(VIN_SERIAL_DIGITS, "0");
  const fillerLength = VIN_LENGTH - VIN_PREFIX.length - serial.length;
  const filler = Array.from(
    { length: fillerLength },
    (_, index) => VIN_LETTERS[(number * 7 + index * 13) % VIN_LETTERS.length],
  );
  // Ends in the car's number, so no two demo cars share one.
  return `${VIN_PREFIX}${filler.join("")}${serial}`;
}

/** Car number `number` (from 1) of the demo fleet: always the same car for the same number. */
export function demoCar(number: number): DemoCar {
  const year = NEWEST_YEAR - ((number * 3) % YEARS_SPREAD);
  return {
    number,
    rego: demoRego(number),
    role: DEMO_CAR_ROLES[number - 1] ?? "idle",
    regoState: STATES[number % STATES.length]!,
    model: DEMO_MODELS[(number - 1) % DEMO_MODELS.length]!,
    year,
    colour: COLOURS[number % COLOURS.length]!,
    kilometres: (NEWEST_YEAR + 1 - year) * KILOMETRES_PER_YEAR + number * 1_234,
    vin: number % CARS_PER_MISSING_VIN === 0 ? null : demoVin(number),
  };
}

export function allDemoCars(): DemoCar[] {
  return Array.from({ length: DEMO_CAR_COUNT }, (_, index) => demoCar(index + 1));
}

/** The business's car with this rego, archived or not. */
export async function findCarId(context: DemoContext, rego: string): Promise<string | null> {
  const [car] = await withTenant(context.deps.database, context.actor.operatorId, (tx) =>
    tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.operatorId, context.actor.operatorId), eq(vehicles.rego, rego))),
  );
  return car?.id ?? null;
}

async function createDemoCar(context: DemoContext, car: DemoCar): Promise<string> {
  const input = checkedInput(
    parseNewVehicleForm(
      {
        ...EMPTY_VEHICLE_FORM,
        rego: car.rego,
        regoState: car.regoState,
        make: car.model.make,
        model: car.model.model,
        variant: car.model.variant,
        year: String(car.year),
        colour: car.colour,
        bodyType: car.model.bodyType,
        transmission: car.model.transmission,
        fuelType: car.model.fuelType,
        seats: String(car.model.seats),
        vin: car.vin ?? "",
        kilometres: String(car.kilometres),
        dailyRateCents: centsForEditing(DEMO_DAILY_RATE_CENTS),
        longTermWeeklyCents: centsForEditing(DEMO_LONG_TERM_WEEKLY_CENTS),
      },
      new Date(),
      context.catalogue,
    ),
    `car ${car.rego}`,
  );
  const result = await createVehicle(context.deps.database, context.actor, input);
  if (result.status !== "saved") {
    throw new DemoDataError(`Demo car ${car.rego} was not saved: ${result.status}`);
  }
  return result.vehicleId;
}

/** Days from today a car's rego runs out: a mix of current, due soon and expired. */
function regoExpiryDays(car: DemoCar): number | null {
  if (car.number % 7 === 0) {
    return -(10 + car.number);
  }
  if (car.number % 5 === 0) {
    return 3 + (car.number % 20);
  }
  return 40 + ((car.number * 37) % 300);
}

const REGO_YEARLY_CENTS = 870_00;
const REGO_MONTHLY_CENTS = 75_00;

async function addDemoRego(context: DemoContext, carId: string, car: DemoCar): Promise<void> {
  if (car.role === "no_paperwork") {
    return;
  }
  const isDirectDebit = car.number % 4 === 1;
  const expiryDays = regoExpiryDays(car);
  if (car.number % 6 === 0 && expiryDays !== null) {
    // Last year's rego first, so the car has a renewal history.
    await saveRego(context, carId, car, { termMonths: 12, expiresOn: expiryDays - 365 });
  }
  await saveRego(context, carId, car, {
    termMonths: isDirectDebit ? 1 : 12,
    expiresOn: isDirectDebit ? null : expiryDays,
  });
}

async function saveRego(
  context: DemoContext,
  carId: string,
  car: DemoCar,
  term: { termMonths: number; expiresOn: number | null },
): Promise<void> {
  const isDirectDebit = term.expiresOn === null;
  const paidDays = isDirectDebit ? -60 : (term.expiresOn ?? 0) - 365;
  const input = checkedInput(
    parseRegoForm({
      ...emptyRegoForm(),
      state: car.regoState,
      termMonths: String(term.termMonths),
      expiresOn: isDirectDebit ? "" : dayFrom(context, term.expiresOn ?? 0),
      paidOn: dayFrom(context, paidDays),
      costCents: centsForEditing(isDirectDebit ? REGO_MONTHLY_CENTS : REGO_YEARLY_CENTS),
      gstCents: "",
    }),
    `rego of ${car.rego}`,
  );
  const result = await addRegistration(
    context.deps.database,
    context.actor,
    carId,
    input,
    context.today,
  );
  expectSaved(result.status, ["added", "duplicate"], `rego of ${car.rego}`);
}

const PRIVATE_SELLERS = ["Jordan Sample", "Casey Example", "Riley Madeup"];
const DEALERS = ["Example Motors Pty Ltd", "Sample Car Sales", "Demo Auto Group"];
const DAYS_PER_YEAR = 365;

async function addDemoPurchase(context: DemoContext, carId: string, car: DemoCar): Promise<void> {
  const isPrivate = car.number % 3 === 2;
  const ageDays = Math.max(30, (NEWEST_YEAR + 1 - car.year) * DAYS_PER_YEAR - 200);
  const priceCents = car.model.priceCents - (NEWEST_YEAR - car.year) * 2_500_00;
  const sellers = isPrivate ? PRIVATE_SELLERS : DEALERS;
  const input = checkedInput(
    parsePurchaseForm({
      ...emptyPurchaseForm(),
      purchasedOn: dayFrom(context, -Math.min(ageDays, 3 * DAYS_PER_YEAR)),
      source: isPrivate ? "private" : "dealer",
      sellerName: sellers[car.number % sellers.length]!,
      sellerPhone: isPrivate ? "0491 570 156" : "",
      sellerAddress: isPrivate ? "" : "100 Example Highway, Osborne Park WA 6017",
      kilometres: String(Math.max(0, car.kilometres - 20_000)),
      priceCents: centsForEditing(priceCents),
      gstCents: isPrivate ? "" : centsForEditing(gstIncludedIn(priceCents)),
    }),
    `purchase of ${car.rego}`,
  );
  const result = await savePurchase(
    context.deps.database,
    context.actor,
    carId,
    input,
    context.timeZone,
  );
  expectSaved(result, ["saved", "unchanged"], `purchase of ${car.rego}`);
}

interface DemoCost {
  kind: "servicing" | "repair" | "refurb" | "other";
  description: string;
  costCents: number;
  daysAgo: number;
}

function demoCosts(car: DemoCar): DemoCost[] {
  const costs: DemoCost[] = [];
  if (car.number % 2 === 0) {
    costs.push({
      kind: "servicing",
      description: "Logbook service",
      costCents: 389_00,
      daysAgo: 40,
    });
  }
  if (car.number % 2 === 1) {
    costs.push({
      kind: "servicing",
      description: "Oil and filter",
      costCents: 189_50,
      daysAgo: 95,
    });
  }
  if (car.number % 5 === 0) {
    costs.push({
      kind: "repair",
      description: "Rear bumper respray",
      costCents: 1_250_00,
      daysAgo: 120,
    });
  }
  if (car.number % 7 === 0) {
    costs.push({
      kind: "refurb",
      description: "Seat covers and detailing",
      costCents: 640_00,
      daysAgo: 200,
    });
  }
  if (car.number % 9 === 0) {
    costs.push({ kind: "other", description: "Four new tyres", costCents: 980_00, daysAgo: 15 });
  }
  return costs;
}

async function addDemoCosts(context: DemoContext, carId: string, car: DemoCar): Promise<void> {
  for (const cost of demoCosts(car)) {
    const input = checkedInput(
      parseCostForm({
        ...emptyCostForm(),
        incurredOn: dayFrom(context, -cost.daysAgo),
        kind: cost.kind,
        description: cost.description,
        costCents: centsForEditing(cost.costCents),
        gstCents: centsForEditing(gstIncludedIn(cost.costCents)),
      }),
      `cost of ${car.rego}`,
    );
    expectSaved(
      await addCost(context.deps.database, context.actor, carId, input),
      ["added"],
      `cost of ${car.rego}`,
    );
  }
}

async function addDemoPhoto(context: DemoContext, carId: string): Promise<void> {
  const picture = pictureFrom(DEMO_PICTURES.side);
  const start = await startCarPhotoUpload(
    context.deps,
    context.actor,
    carId,
    { photo: plannedSizeOf(picture), thumbnail: plannedSizeOf(picture) },
    context.timeZone,
  );
  await sendDemoPhoto(context, start, picture);
}

const STATUS_CHANGES: Partial<
  Record<DemoCarRole, { status: string; statusReason: string; backInDays: number | null }>
> = {
  booked_in_service: { status: "in_service", statusReason: "Timing belt", backInDays: 3 },
  in_service: { status: "in_service", statusReason: "Major service", backInDays: 2 },
  off_road: { status: "off_road", statusReason: "Waiting on a new windscreen", backInDays: 10 },
  written_off: { status: "written_off", statusReason: "", backInDays: null },
};

async function setDemoStatus(context: DemoContext, carId: string, car: DemoCar): Promise<void> {
  const change = STATUS_CHANGES[car.role];
  if (!change) {
    return;
  }
  const input = checkedInput(
    vehicleStatusInputSchema.safeParse({
      status: change.status,
      statusReason: change.statusReason,
      statusExpectedBack: change.backInDays === null ? "" : dayFrom(context, change.backInDays),
    }),
    `status of ${car.rego}`,
  );
  expectSaved(
    await changeVehicleStatus(context.deps.database, context.actor, carId, input),
    ["changed", "unchanged"],
    `status of ${car.rego}`,
  );
}

async function sellDemoCar(context: DemoContext, carId: string, car: DemoCar): Promise<void> {
  const input = checkedInput(
    parseSaleForm(
      {
        ...emptySaleForm(),
        soldAt: momentText(dayFrom(context, -(20 + car.number)), "14:30"),
        priceCents: centsForEditing(car.model.priceCents / 2),
        gstCents: centsForEditing(gstIncludedIn(car.model.priceCents / 2)),
        buyerName: "Morgan Madeup",
        buyerPhone: "0491 570 157",
        buyerAddress: "7 Sample Road, Midland WA 6056",
        buyerLicenceNumber: "",
        buyerLicenceState: "",
        transferLodgedOn: car.number % 2 === 0 ? dayFrom(context, -(18 + car.number)) : "",
        transferReference: car.number % 2 === 0 ? `DEMO-TR-${car.number}` : "",
      },
      context.timeZone,
    ),
    `sale of ${car.rego}`,
  );
  const result = await saveSale(
    context.deps.database,
    context.actor,
    carId,
    input,
    context.timeZone,
  );
  expectSaved(result, ["saved", "unchanged"], `sale of ${car.rego}`);
}

/**
 * Adds one demo car with its paperwork, purchase, costs, a photo and its
 * status, through the same code as the car screens. A car already there is
 * left alone, so pressing the button again adds only what is missing.
 */
export async function addDemoCar(context: DemoContext, car: DemoCar): Promise<"added" | "there"> {
  if (await findCarId(context, car.rego)) {
    return "there";
  }
  const carId = await createDemoCar(context, car);
  await addDemoRego(context, carId, car);
  await addDemoPurchase(context, carId, car);
  await addDemoCosts(context, carId, car);
  await addDemoPhoto(context, carId);
  await setDemoStatus(context, carId, car);
  if (car.role === "sold") {
    await sellDemoCar(context, carId, car);
  }
  if (car.role === "archived") {
    const archived = await archiveVehicle(context.deps.database, context.actor, carId);
    expectSaved(
      typeof archived === "string" ? archived : "same rego as another car",
      ["changed"],
      `archiving ${car.rego}`,
    );
  }
  return "added";
}
