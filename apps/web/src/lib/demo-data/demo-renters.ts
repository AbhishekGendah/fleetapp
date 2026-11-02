import { LICENCE_SIDES, type LicenceSide } from "@fleetapp/core";
import { renters } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";

import { sendDetailsLink } from "../renter-links/details-links";
import { parseLicenceForm, type LicenceFormValues } from "../renters/licence-input";
import { saveLicence } from "../renters/licence-records";
import { startLicenceScanUpload } from "../renters/licence-scans";
import { addNote } from "../renters/notes";
import { emptyRenterForm, parseRenterForm, renterStatusInputSchema } from "../renters/renter-input";
import { archiveRenter, changeRenterStatus, createRenter } from "../renters/renter-records";
import {
  checkedInput,
  dayFrom,
  expectSaved,
  type DemoContext,
  DemoDataError,
} from "./demo-context";
import { pictureFrom, plannedSizeOf, sendDemoUpload } from "./demo-files";
import { DEMO_PICTURES } from "./demo-pictures";
import type { DemoRenterPlan, DemoRenterProfile } from "./demo-plan";

/** Mobile numbers the Australian regulator keeps for fiction: they never ring anyone. */
const FICTION_PHONES = [
  "0491 570 006",
  "0491 570 156",
  "0491 570 157",
  "0491 570 158",
  "0491 570 159",
  "0491 570 110",
  "0491 570 313",
  "0491 570 737",
  "0491 571 266",
  "0491 571 491",
  "0491 571 804",
  "0491 572 549",
  "0491 572 665",
  "0491 572 983",
  "0491 573 770",
  "0491 573 087",
  "0491 574 118",
  "0491 574 632",
  "0491 575 254",
  "0491 575 789",
] as const;

const SUBURBS = [
  "Perth WA 6000",
  "Fremantle WA 6160",
  "Joondalup WA 6027",
  "Midland WA 6056",
  "Rockingham WA 6168",
  "Cannington WA 6107",
  "Scarborough WA 6019",
  "Armadale WA 6112",
] as const;
const STREETS = ["Example Street", "Sample Road", "Madeup Avenue", "Demo Lane", "Test Parade"];
const LICENCE_ISSUERS = ["WA", "WA", "WA", "NSW", "VIC", "QLD", "SA", "TAS"] as const;
const OVERSEAS_COUNTRIES = ["NZ", "GB", "IN"] as const;
const LICENCE_NUMBER_BASE = 41_000_000;
const DETAILS_LINK_DAYS = 7;
const OLDEST_BIRTH_YEAR = 1968;
const BIRTH_YEARS_SPREAD = 33;
const UNDER_AGE_YEARS = 20;
const DAYS_PER_YEAR = 365;

/** Profiles whose Renter has a name and a way to reach them, and nothing else yet. */
const CONTACT_ONLY_PROFILES: readonly DemoRenterProfile[] = [
  "details_missing",
  "phone_only",
  "email_only",
];

function emailFor(plan: DemoRenterPlan): string {
  const name = plan.fullName.toLowerCase().replace(/[^a-z]+/g, ".");
  return `${name}@example.test`;
}

function addressFor(plan: DemoRenterPlan): string {
  const street = STREETS[plan.number % STREETS.length]!;
  return `${plan.number + 3} ${street}, ${SUBURBS[plan.number % SUBURBS.length]!}`;
}

function birthDateFor(context: DemoContext, plan: DemoRenterPlan): string {
  if (plan.profile === "under_age") {
    return dayFrom(context, -UNDER_AGE_YEARS * DAYS_PER_YEAR);
  }
  const year = OLDEST_BIRTH_YEAR + ((plan.number * 7) % BIRTH_YEARS_SPREAD);
  const month = String((plan.number % 12) + 1).padStart(2, "0");
  return `${year}-${month}-${String((plan.number % 27) + 1).padStart(2, "0")}`;
}

function renterFormFor(context: DemoContext, plan: DemoRenterPlan) {
  const isContactOnly = CONTACT_ONLY_PROFILES.includes(plan.profile);
  const hasFull = plan.hasFullContactDetails === true;
  return {
    ...emptyRenterForm(),
    fullName: plan.fullName,
    preferredName: plan.preferredName ?? "",
    phone:
      plan.profile === "email_only" ? "" : FICTION_PHONES[plan.number % FICTION_PHONES.length]!,
    email: plan.profile === "phone_only" ? "" : emailFor(plan),
    dateOfBirth: isContactOnly ? "" : birthDateFor(context, plan),
    residentialAddress: isContactOnly ? "" : addressFor(plan),
    isPostalSameAsHome: hasFull ? "" : emptyRenterForm().isPostalSameAsHome,
    postalAddress: hasFull ? `PO Box ${plan.number * 11}, Perth WA 6000` : "",
    emergencyContactName: hasFull ? "Pat Madeup" : "",
    emergencyContactPhone: hasFull ? FICTION_PHONES[0] : "",
    emergencyContactRelationship: hasFull ? "Partner" : "",
  };
}

/** Days from today the licence runs out. */
function licenceExpiryDays(profile: DemoRenterProfile, number: number): number {
  switch (profile) {
    case "licence_due_soon":
      return 10 + (number % 15);
    case "licence_expired":
      return -40;
    default:
      return 2 * DAYS_PER_YEAR + number * 23;
  }
}

function licenceFormFor(context: DemoContext, plan: DemoRenterPlan): LicenceFormValues {
  const isOverseas = plan.profile === "overseas" || plan.profile === "overseas_front_only";
  return {
    licenceIssuedIn: isOverseas
      ? "overseas"
      : LICENCE_ISSUERS[plan.number % LICENCE_ISSUERS.length]!,
    licenceCountry: isOverseas ? OVERSEAS_COUNTRIES[plan.number % OVERSEAS_COUNTRIES.length]! : "",
    licenceNumber: String(LICENCE_NUMBER_BASE + plan.number),
    licenceClass: plan.number % 10 === 1 ? "LR" : "C",
    licenceType: plan.profile === "provisional" ? "provisional" : "full",
    licenceExpiresOn: dayFrom(context, licenceExpiryDays(plan.profile, plan.number)),
  };
}

const SCAN_PICTURES: Readonly<Record<LicenceSide, string>> = {
  front: DEMO_PICTURES.licenceFront,
  back: DEMO_PICTURES.licenceBack,
};

async function addDemoScans(context: DemoContext, renterId: string, plan: DemoRenterPlan) {
  const sides = plan.profile === "overseas_front_only" ? (["front"] as const) : LICENCE_SIDES;
  for (const side of sides) {
    const picture = pictureFrom(SCAN_PICTURES[side]);
    const start = await startLicenceScanUpload(
      context.deps,
      context.actor,
      renterId,
      side,
      plannedSizeOf(picture),
    );
    if (start.status !== "allowed") {
      throw new DemoDataError(`A demo licence scan was not allowed: ${start.status}`);
    }
    await sendDemoUpload(context.deps, context.actor, {
      fileId: start.fileId,
      picture,
      purposes: ["renter_licence_scan"],
    });
  }
}

async function addDemoLicence(context: DemoContext, renterId: string, plan: DemoRenterPlan) {
  if (CONTACT_ONLY_PROFILES.includes(plan.profile)) {
    return;
  }
  const licence = checkedInput(parseLicenceForm(licenceFormFor(context, plan)), "licence");
  const saved = await saveLicence(context.deps.database, context.actor, renterId, licence);
  expectSaved(
    typeof saved === "string" ? saved : "held by another Renter",
    ["saved", "unchanged"],
    `licence of ${plan.fullName}`,
  );
  await addDemoScans(context, renterId, plan);
}

async function setDemoRenterStanding(context: DemoContext, renterId: string, plan: DemoRenterPlan) {
  if (plan.doNotRentReason) {
    const input = checkedInput(
      renterStatusInputSchema.safeParse({
        status: "do_not_rent",
        doNotRentReason: plan.doNotRentReason,
      }),
      "Renter status",
    );
    expectSaved(
      await changeRenterStatus(context.deps.database, context.actor, renterId, input),
      ["changed"],
      `status of ${plan.fullName}`,
    );
  }
  if (plan.profile === "archived") {
    expectSaved(
      await archiveRenter(context.deps.database, context.actor, renterId),
      ["changed"],
      `archiving ${plan.fullName}`,
    );
  }
}

/** The business's Renter with this name, archived or not. */
export async function findRenterId(context: DemoContext, fullName: string): Promise<string | null> {
  const [found] = await withTenant(context.deps.database, context.actor.operatorId, (tx) =>
    tx
      .select({ id: renters.id })
      .from(renters)
      .where(and(eq(renters.operatorId, context.actor.operatorId), eq(renters.fullName, fullName))),
  );
  return found?.id ?? null;
}

/**
 * Adds one demo Renter with their licence, scans, notes and standing,
 * through the same code as the Renter screens. One already there is left
 * alone. Renters still missing details are sent the details form by email
 * (it lands in the test inbox).
 */
export async function addDemoRenter(
  context: DemoContext,
  plan: DemoRenterPlan,
): Promise<"added" | "there"> {
  if (await findRenterId(context, plan.fullName)) {
    return "there";
  }
  const input = checkedInput(
    parseRenterForm(renterFormFor(context, plan), context.today),
    "Renter",
  );
  const renterId = await createRenter(context.deps.database, context.actor, input);
  await addDemoLicence(context, renterId, plan);
  if (plan.note) {
    expectSaved(
      await addNote(context.deps.database, context.actor, renterId, plan.note),
      ["added"],
      `note for ${plan.fullName}`,
    );
  }
  if (plan.profile === "details_missing" || plan.profile === "email_only") {
    const sent = await sendDetailsLink(context.links, context.actor, renterId, DETAILS_LINK_DAYS);
    expectSaved(sent.status, ["sent"], `details form for ${plan.fullName}`);
  }
  await setDemoRenterStanding(context, renterId, plan);
  return "added";
}
